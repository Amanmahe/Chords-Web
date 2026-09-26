import type { FlashCallbacks, FlashJob } from "./types";
import { hex } from "./firmware";
import { sleep } from "./serial";
import { openBootloaderUsb, restartIfStillThere } from "./usb";

/* -------------------------------------------------------------------------- */
/* USB DFU 1.1 + ST DfuSe over WebUSB                                          */
/* -------------------------------------------------------------------------- */

const DFU = { DETACH: 0, DNLOAD: 1, UPLOAD: 2, GETSTATUS: 3, CLRSTATUS: 4, GETSTATE: 5, ABORT: 6 } as const;
const STATE = {
  appIDLE: 0,
  appDETACH: 1,
  dfuIDLE: 2,
  dfuDNLOAD_SYNC: 3,
  dfuDNBUSY: 4,
  dfuDNLOAD_IDLE: 5,
  dfuMANIFEST_SYNC: 6,
  dfuMANIFEST: 7,
  dfuMANIFEST_WAIT_RESET: 8,
  dfuUPLOAD_IDLE: 9,
  dfuERROR: 10,
} as const;

interface Segment {
  start: number;
  end: number;
  sectorSize: number;
  erasable: boolean;
  writable: boolean;
}

/** Parse "@Internal Flash  /0x08000000/04*016Kg,01*064Kg,07*128Kg" */
export function parseDfuseMemory(desc: string): { name: string; segments: Segment[] } {
  const parts = desc.split("/");
  const name = parts[0].replace(/^@/, "").trim();
  const segments: Segment[] = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    let addr = parseInt(parts[i], 16);
    for (const sec of parts[i + 1].split(",")) {
      const m = sec.trim().match(/^(\d+)\*(\d+)\s?([BKM ]?)([a-g])/);
      if (!m) continue;
      const count = parseInt(m[1], 10);
      const mult = m[3] === "K" ? 1024 : m[3] === "M" ? 1024 * 1024 : 1;
      const size = parseInt(m[2], 10) * mult;
      const t = m[4].charCodeAt(0) - "a".charCodeAt(0) + 1;
      segments.push({
        start: addr,
        end: addr + count * size,
        sectorSize: size,
        erasable: (t & 2) !== 0,
        writable: (t & 4) !== 0,
      });
      addr += count * size;
    }
  }
  return { name, segments };
}

class DfuDevice {
  constructor(
    public dev: USBDevice,
    public intf: number,
    public alt: number,
    public transferSize: number,
    public altName: string,
  ) {}

  private out(request: number, value: number, data?: BufferSource) {
    return this.dev.controlTransferOut(
      { requestType: "class", recipient: "interface", request, value, index: this.intf },
      data,
    );
  }

  private async in(request: number, value: number, length: number) {
    const r = await this.dev.controlTransferIn(
      { requestType: "class", recipient: "interface", request, value, index: this.intf },
      length,
    );
    if (r.status !== "ok" || !r.data) throw new Error(`DFU control IN failed (${r.status})`);
    return r.data;
  }

  async getStatus() {
    const d = await this.in(DFU.GETSTATUS, 0, 6);
    return {
      status: d.getUint8(0),
      pollTimeout: d.getUint8(1) | (d.getUint8(2) << 8) | (d.getUint8(3) << 16),
      state: d.getUint8(4),
    };
  }

  clearStatus() {
    return this.out(DFU.CLRSTATUS, 0);
  }

  abort() {
    return this.out(DFU.ABORT, 0);
  }

  async download(block: number, data: Uint8Array) {
    const r = await this.out(DFU.DNLOAD, block, data as BufferSource);
    if (r.status !== "ok") throw new Error(`DFU_DNLOAD failed (${r.status})`);
  }

  detach() {
    return this.out(DFU.DETACH, 1000);
  }

  /** Poll GETSTATUS until the device leaves the busy state. */
  async pollUntil(done: (state: number) => boolean) {
    for (;;) {
      const s = await this.getStatus();
      if (s.status !== 0) {
        await this.clearStatus().catch(() => {});
        throw new Error(`DFU error status ${s.status} (state ${s.state})`);
      }
      if (done(s.state)) return s.state;
      await sleep(Math.max(s.pollTimeout, 1));
    }
  }

  /** Make sure we start from dfuIDLE. */
  async ensureIdle() {
    let s = await this.getStatus();
    if (s.state === STATE.dfuERROR) {
      await this.clearStatus();
      s = await this.getStatus();
    }
    if (s.state !== STATE.dfuIDLE) {
      await this.abort().catch(() => {});
      s = await this.getStatus();
    }
    if (s.state !== STATE.dfuIDLE) throw new Error(`Device not idle (state ${s.state})`);
  }

  async close() {
    try {
      await this.dev.releaseInterface(this.intf);
    } catch {}
    try {
      await this.dev.close();
    } catch {}
  }
}

/* ---- descriptors ---- */

async function readConfigDescriptor(dev: USBDevice): Promise<DataView> {
  const setup = (len: number) =>
    dev.controlTransferIn(
      { requestType: "standard", recipient: "device", request: 0x06, value: 0x0200, index: 0 },
      len,
    );
  const head = await setup(9);
  const total = head.data!.getUint16(2, true);
  const full = await setup(total);
  return full.data!;
}

async function readString(dev: USBDevice, index: number): Promise<string> {
  if (!index) return "";
  const r = await dev.controlTransferIn(
    { requestType: "standard", recipient: "device", request: 0x06, value: 0x0300 | index, index: 0x0409 },
    255,
  );
  const d = r.data!;
  let s = "";
  for (let i = 2; i + 1 < d.getUint8(0); i += 2) s += String.fromCharCode(d.getUint16(i, true));
  return s;
}

interface DescInfo {
  transferSize: number;
  altNames: Map<string, number>; // "intf:alt" -> iInterface
}

function parseConfig(d: DataView): DescInfo {
  const info: DescInfo = { transferSize: 0, altNames: new Map() };
  let i = 0;
  let curIntf = -1;
  let curAlt = -1;
  let curIsDfu = false;
  while (i + 1 < d.byteLength) {
    const len = d.getUint8(i);
    const type = d.getUint8(i + 1);
    if (len === 0) break;
    if (type === 0x04) {
      curIntf = d.getUint8(i + 2);
      curAlt = d.getUint8(i + 3);
      curIsDfu = d.getUint8(i + 5) === 0xfe && d.getUint8(i + 6) === 0x01;
      info.altNames.set(`${curIntf}:${curAlt}`, d.getUint8(i + 8));
    } else if (type === 0x21 && curIsDfu && len >= 7) {
      info.transferSize = d.getUint16(i + 5, true);
    }
    i += len;
  }
  return info;
}

async function openDfu(filters: USBDeviceFilter[], afterReset: boolean, cb: FlashCallbacks, preferAlt?: RegExp) {
  const dev = await openBootloaderUsb(filters, afterReset, "DFU device");
  if (!dev.configuration) await dev.selectConfiguration(1);

  const desc = parseConfig(await readConfigDescriptor(dev));

  // Collect DFU-mode alternates
  const alts: { intf: number; alt: number; name: string }[] = [];
  for (const itf of dev.configuration!.interfaces) {
    for (const a of itf.alternates) {
      if (a.interfaceClass === 0xfe && a.interfaceSubclass === 0x01) {
        let name = a.interfaceName ?? "";
        if (!name) {
          name = await readString(dev, desc.altNames.get(`${itf.interfaceNumber}:${a.alternateSetting}`) ?? 0).catch(
            () => "",
          );
        }
        alts.push({ intf: itf.interfaceNumber, alt: a.alternateSetting, name });
      }
    }
  }
  if (!alts.length) throw new Error("Selected device has no DFU interface");
  const chosen = (preferAlt && alts.find((a) => preferAlt.test(a.name))) || alts.find((a) => a.alt === 0) || alts[0];

  await dev.claimInterface(chosen.intf);
  if (chosen.alt !== 0 || alts.length > 1) await dev.selectAlternateInterface(chosen.intf, chosen.alt);

  const xfer = desc.transferSize || 1024;
  cb.log(`DFU device ${dev.productName ?? ""} · alt ${chosen.alt} "${chosen.name}" · transfer ${xfer} B`);
  return new DfuDevice(dev, chosen.intf, chosen.alt, xfer, chosen.name);
}

/* -------------------------------------------------------------------------- */
/* Flash: plain DFU (UNO R4 Minima)                                            */
/* -------------------------------------------------------------------------- */

export async function flashDfu(job: FlashJob, afterReset: boolean) {
  const { device, parts, cb } = job;
  const dfu = await openDfu(device.usbFilters!, afterReset, cb);
  try {
    await dfu.ensureIdle();
    const data = parts[0].data;
    const n = Math.ceil(data.length / dfu.transferSize);
    for (let b = 0; b < n; b++) {
      const chunk = data.subarray(b * dfu.transferSize, (b + 1) * dfu.transferSize);
      await dfu.download(b, chunk);
      await dfu.pollUntil((s) => s === STATE.dfuDNLOAD_IDLE);
      cb.progress(((b + 1) / n) * 100, "Writing flash");
    }
    // zero-length download -> manifestation
    await dfu.download(n, new Uint8Array());
    try {
      await dfu.pollUntil((s) => s === STATE.dfuIDLE || s === STATE.dfuMANIFEST_WAIT_RESET);
    } catch {
      /* some bootloaders reset during manifestation */
    }
    cb.log("Download complete, starting sketch…");
    await dfu.detach().catch(() => {});
  } finally {
    await dfu.close();
  }
  await restartIfStillThere(dfu.dev);
}


/* -------------------------------------------------------------------------- */
/* Flash: DfuSe (STM32 ROM bootloader, Arduino GIGA)                           */
/* -------------------------------------------------------------------------- */

export async function flashDfuse(job: FlashJob, afterReset: boolean) {
  const { device, parts, cb } = job;
  const dfu = await openDfu(device.usbFilters!, afterReset, cb, /flash/i);
  const start = device.dfuseAddress ?? parts[0].address;
  const data = parts[0].data;

  const special = async (cmd: number, addr?: number) => {
    const buf =
      addr === undefined
        ? new Uint8Array([cmd])
        : new Uint8Array([cmd, addr & 0xff, (addr >>> 8) & 0xff, (addr >>> 16) & 0xff, (addr >>> 24) & 0xff]);
    await dfu.download(0, buf);
    await dfu.pollUntil((s) => s === STATE.dfuDNLOAD_IDLE || s === STATE.dfuIDLE);
  };

  try {
    await dfu.ensureIdle();
    const mem = parseDfuseMemory(dfu.altName);
    if (!mem.segments.length) throw new Error(`Can't read memory layout from "${dfu.altName}"`);

    // 1. erase every sector the image touches
    const end = start + data.length;
    const sectors: number[] = [];
    for (const seg of mem.segments) {
      for (let a = seg.start; a < seg.end; a += seg.sectorSize) {
        if (a + seg.sectorSize > start && a < end) {
          if (!seg.writable) throw new Error(`${hex(a)} is not writable`);
          if (seg.erasable) sectors.push(a);
        }
      }
    }
    if (end > mem.segments[mem.segments.length - 1].end) {
      throw new Error(`Firmware (${data.length} B) doesn't fit in ${mem.name}`);
    }
    cb.log(`Erasing ${sectors.length} sector(s)…`);
    for (let i = 0; i < sectors.length; i++) {
      await special(0x41, sectors[i]);
      cb.progress(((i + 1) / sectors.length) * 30, "Erasing");
    }

    // 2. write
    cb.log(`Writing ${data.length} bytes at ${hex(start)}…`);
    const xfer = dfu.transferSize;
    const n = Math.ceil(data.length / xfer);
    for (let b = 0; b < n; b++) {
      await special(0x21, start + b * xfer); // set address pointer
      await dfu.download(2, data.subarray(b * xfer, (b + 1) * xfer));
      await dfu.pollUntil((s) => s === STATE.dfuDNLOAD_IDLE);
      cb.progress(30 + ((b + 1) / n) * 70, "Writing flash");
    }

    // 3. leave DFU and jump to the application
    cb.log("Leaving DFU mode…");
    await special(0x21, start);
    try {
      await dfu.download(2, new Uint8Array());
      await dfu.getStatus();
    } catch {
      /* device resets here, errors are expected */
    }
  } finally {
    await dfu.close();
  }
}
