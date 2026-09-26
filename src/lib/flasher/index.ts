import type { DeviceDef, FlashCallbacks, FlashJob } from "./types";
import { fetchFirmware, toBinary } from "./firmware";
import { findOrPickSerialPort, pickSerialPort, sleep, touch1200 } from "./serial";
import { flashEsp } from "./esp";
import { flashStk500v1, flashStk500v2 } from "./avr";
import { flashDfu, flashDfuse } from "./dfu";
import { findBootloaderUsb } from "./usb";
import { flashUnoR4Wifi } from "./samba-r4";
import { flashUf2 } from "./uf2";
import { flashPicoboot } from "./picoboot";

export * from "./types";
export { setPreferredSerialPort } from "./serial";
export { DEVICES, PROTOCOL_LABEL } from "./devices";

export interface FlashRequest {
  device: DeviceDef;
  /** Custom upload; if absent the bundled firmware is fetched from /public. */
  file?: File | null;
  /** ESP32: flash offset of a custom upload. */
  customAddress?: number;
  eraseAll?: boolean;
  verify?: boolean;
  /** DFU boards: board is already in bootloader mode (double-tapped RESET). */
  skipTouch?: boolean;
}

export function browserSupport() {
  if (typeof navigator === "undefined") return { serial: false, usb: false, fsAccess: false };
  return {
    serial: "serial" in navigator,
    usb: "usb" in navigator,
    fsAccess: typeof window !== "undefined" && "showDirectoryPicker" in window,
  };
}

export function needsApi(device: DeviceDef): "serial" | "usb" | "fs" {
  if (device.protocol === "dfu" || device.protocol === "dfuse" || device.protocol === "picoboot") return "usb";
  if (device.protocol === "uf2") return "fs";
  return "serial";
}

async function loadParts(req: FlashRequest, cb: FlashCallbacks): Promise<FlashJob["parts"]> {
  const { device, file } = req;
  const raw: { bytes: Uint8Array; name: string; address: number }[] = [];

  if (file) {
    raw.push({
      bytes: new Uint8Array(await file.arrayBuffer()),
      name: file.name,
      address: req.customAddress ?? device.firmware[0]?.address ?? 0,
    });
  } else {
    if (!device.firmware.length) throw new Error("No bundled firmware for this board. Upload a file.");
    for (const p of device.firmware) {
      cb.log(`Loading ${p.url}…`);
      raw.push({ bytes: await fetchFirmware(p.url), name: p.label ?? p.url.split("/").pop()!, address: p.address });
    }
  }

  return raw.map((r) => {
    if (device.protocol === "uf2" || device.protocol === "picoboot") return { data: r.bytes, address: r.address, name: r.name };
    const { data, start } = toBinary(r.bytes, r.name);
    return { data, address: start ?? r.address, name: r.name };
  });
}

export async function flashDevice(req: FlashRequest, cb: FlashCallbacks) {
  const parts = await loadParts(req, cb);
  const size = parts.reduce((a, p) => a + p.data.length, 0);
  cb.log(`Firmware: ${parts.map((p) => p.name).join(", ")} (${(size / 1024).toFixed(1)} KB)`);

  const job: FlashJob = {
    device: req.device,
    parts,
    options: { eraseAll: !!req.eraseAll, verify: req.verify ?? true },
    cb,
  };

  switch (req.device.protocol) {
    case "esptool":
      return flashEsp(job);
    case "stk500v1":
      return flashStk500v1(job);
    case "stk500v2":
      return flashStk500v2(job);
    case "samba-r4":
      return flashUnoR4Wifi(job);
    case "uf2":
      return flashUf2(job);
    case "dfu":
    case "dfuse":
    case "picoboot": {
      let afterReset = false;
      const inBootloader = !!(await findBootloaderUsb(req.device.usbFilters!));
      if (req.device.touch1200 && !req.skipTouch && !inBootloader) {
        cb.log("Resetting the board into the bootloader…");
        const port = await findOrPickSerialPort(req.device.serialFilters).catch((e) => {
          // No serial port picked: the board may already be in bootloader mode
          // (it has no serial port then), so go straight to the DFU picker.
          if (e instanceof DOMException && e.name === "NotFoundError") return undefined;
          throw e;
        });
        if (port) {
          // The sketch's serial port goes away when the board really restarts.
          const left = new Promise<boolean>((resolve) => {
            port.addEventListener("disconnect", () => resolve(true), { once: true });
            setTimeout(() => resolve(false), 3000);
          });
          await touch1200(port);
          cb.log("Waiting for the bootloader to enumerate…");
          if (!(await left)) {
            throw new Error(
              "The board didn't restart into its bootloader: its serial port is still there. " +
                (req.device.resetHint ?? "Its firmware may not support the 1200 baud reset.") +
                ' Put it in bootloader mode by hand, then use "Board is already in bootloader".',
            );
          }
          await sleep(1000);
          afterReset = true;
        } else {
          cb.log("No serial port picked. If the board is in bootloader mode, pick its USB bootloader device.");
        }
      }
      if (req.device.protocol === "picoboot") return flashPicoboot(job, afterReset);
      return req.device.protocol === "dfu" ? flashDfu(job, afterReset) : flashDfuse(job, afterReset);
    }
  }
}

/**
 * Revoke every USB device and serial port this site was granted, so the next
 * flash asks for them again. Dead entries Chrome still shows in its picker
 * only go away when the browser restarts.
 */
export async function forgetDevices() {
  let usb = 0;
  let serial = 0;
  if (typeof navigator !== "undefined" && "usb" in navigator) {
    for (const d of await navigator.usb.getDevices()) {
      await d.close().catch(() => {});
      await d.forget();
      usb++;
    }
  }
  if (typeof navigator !== "undefined" && "serial" in navigator) {
    for (const p of await navigator.serial.getPorts()) {
      await p.close().catch(() => {});
      await p.forget();
      serial++;
    }
  }
  return { usb, serial };
}

/** RP2040 running an Arduino sketch: 1200 baud touch reboots into BOOTSEL. */
export async function resetToBootloader() {
  const port = await pickSerialPort();
  await touch1200(port);
}
