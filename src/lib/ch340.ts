import { toast } from "@/lib/toast";

/**
 * Clone boards (Arduino Nano / UNO / Mega clones) use a WCH CH340 USB-serial
 * chip. Windows and macOS need its driver: without it the board never shows
 * up as a serial port, so it can't be connected or flashed.
 */
export const CH340_VENDOR_ID = 0x1a86;

export function isCh340(info?: { usbVendorId?: number }) {
    return info?.usbVendorId === CH340_VENDOR_ID;
}

type Os = "windows" | "mac" | "linux" | "other";

function detectOs(): Os {
    if (typeof navigator === "undefined") return "other";
    const ua = navigator.userAgent;
    if (/Windows/i.test(ua)) return "windows";
    if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
    if (/Linux/i.test(ua)) return "linux";
    return "other";
}

// Official WCH driver downloads.
const DRIVER_URL: Record<Os, string> = {
    windows: "https://www.wch-ic.com/downloads/CH341SER_EXE.html",
    mac: "https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html",
    linux: "https://www.wch-ic.com/downloads/CH341SER_LINUX_ZIP.html",
    other: "https://www.wch-ic.com/products/CH340.html",
};

/**
 * Suggests the CH340 driver. `when` says why, e.g. "can't find the board".
 * On Linux the driver is built into the kernel, so it points at the usual
 * causes there instead of a download.
 */
export function showCh340DriverToast(when: string) {
    const os = detectOs();
    if (os === "linux") {
        toast.warning(`${when}: using a clone board (CH340)?`, {
            description:
                "Linux has the CH340 driver built in. If the port is missing or busy, uninstall brltty " +
                "(it grabs CH340 ports) and make sure your user is in the dialout / uucp group.",
        });
        return;
    }
    toast.warning(`${when}: install the CH340 driver`, {
        description:
            "Clone Arduino boards (Nano, UNO, Mega) use a CH340 USB chip that needs a driver on " +
            `${os === "mac" ? "macOS" : "Windows"}. Install it, replug the board and try again.`,
        action: {
            label: "Download driver",
            onClick: () => window.open(DRIVER_URL[os], "_blank", "noopener,noreferrer"),
        },
    });
}
