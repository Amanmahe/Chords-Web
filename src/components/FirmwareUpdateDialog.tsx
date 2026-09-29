"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { toast } from "@/lib/toast";
import { isCh340, showCh340DriverToast } from "@/lib/ch340";
import { NeedsUserGesture, flashDevice, needsApi, setPreferredSerialPort } from "@/lib/flasher";
import { fetchFirmware } from "@/lib/flasher/firmware";
import {
    fetchLatestFirmware,
    firmwareUrl,
    getFlashTargetsForPid,
    type FlashTarget,
    type LatestFirmware,
} from "@/lib/flasher/chords";

type Status = "idle" | "flashing" | "waiting" | "done" | "error";
type LogLine = { msg: string; kind: "info" | "ok" | "warn" | "err" };

interface FirmwareUpdateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** USB product ID of the board that needs updating. */
    usbProductId: number | null;
    /**
     * Runs when the user presses Flash: disconnects Chords from the board and
     * returns its (now closed) serial port, reused so the user isn't asked to pick it again.
     */
    beforeFlash: () => Promise<SerialPort | null>;
    /** Called after a successful flash; the dialog has closed and the parent reconnects. */
    onFlashed: () => void;
}

/** Revokes this site's access to every remembered USB device matching `filters`. */
async function forgetBootDevices(filters: USBDeviceFilter[]) {
    if (!("usb" in navigator)) return;
    const devices = await navigator.usb.getDevices();
    await Promise.all(
        devices
            .filter((d) =>
                filters.some(
                    (f) =>
                        (f.vendorId === undefined || f.vendorId === d.vendorId) &&
                        (f.productId === undefined || f.productId === d.productId)
                )
            )
            .map((d) => d.forget().catch(() => { }))
    );
}

export default function FirmwareUpdateDialog({
    open,
    onOpenChange,
    usbProductId,
    beforeFlash,
    onFlashed,
}: FirmwareUpdateDialogProps) {
    // The parent remounts this dialog (via `key`) each time it opens, so state starts fresh.
    const [targets] = useState<FlashTarget[]>(() =>
        usbProductId != null ? getFlashTargetsForPid(usbProductId) : []
    );
    const [selected, setSelected] = useState(0);
    const [latest, setLatest] = useState<LatestFirmware | null>(null);
    const [latestError, setLatestError] = useState<string | null>(null);
    const [status, setStatus] = useState<Status>("idle");
    const [progress, setProgress] = useState<{ pct: number; label: string } | null>(null);
    const [logs, setLogs] = useState<LogLine[]>([]);
    const logRef = useRef<HTMLDivElement>(null);
    // Firmware downloaded by the last attempt, reused when Flash is pressed again.
    // Keyed by "<tag>/<asset>"; started as soon as the version is known (see
    // the prefetch effect) so pressing Flash reaches the device picker without
    // waiting on the network.
    const firmwareFileRef = useRef<{ key: string; file: Promise<File> } | null>(null);
    const getFirmwareFile = useCallback((tag: string, asset: string) => {
        const key = `${tag}/${asset}`;
        if (firmwareFileRef.current?.key !== key) {
            const file = fetchFirmware(firmwareUrl(asset, tag)).then(
                (bytes) => new File([bytes as BlobPart], asset)
            );
            // Don't keep a failed download: the next attempt retries it.
            file.catch(() => {
                if (firmwareFileRef.current?.file === file) firmwareFileRef.current = null;
            });
            firmwareFileRef.current = { key, file };
        }
        return firmwareFileRef.current.file;
    }, []);

    const log = useCallback(
        (msg: string, kind: LogLine["kind"] = "info") => setLogs((l) => [...l.slice(-300), { msg, kind }]),
        []
    );

    useEffect(() => {
        if (!open) return;
        fetchLatestFirmware()
            .then(setLatest)
            .catch((e) => {
                const msg = e instanceof Error ? e.message : String(e);
                setLatestError(msg);
                toast.error("Couldn't check for the latest firmware", { description: msg });
            });
    }, [open]);

    useEffect(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    }, [logs]);

    const target = targets[selected];

    // Download the firmware as soon as the version and board are known.
    useEffect(() => {
        if (!open || !target || (!latest && !latestError)) return;
        getFirmwareFile(latest?.tag ?? "latest", target.asset).catch(() => { });
    }, [open, target, latest, latestError, getFirmwareFile]);
    const busy = status === "flashing";
    const assetMissing =
        !!target && Array.isArray(latest?.assets) && !latest.assets.some((a) => a.name === target.asset);

    const runFlash = async () => {
        if (!target || busy) return;
        setStatus("flashing");
        setProgress({ pct: 0, label: "Downloading firmware" });

        // Pin the download to the version shown in the dialog.
        const tag = latest?.tag ?? "latest";
        const device = {
            ...target.device,
            firmware: [{ ...target.device.firmware[0], url: firmwareUrl(target.asset, tag) }],
        };
        // After a "click Flash again" (status "waiting") the board is already
        // in its bootloader: its sketch serial port is gone, so skip the
        // 1200 baud reset and go straight to the USB device picker. Otherwise
        // the flasher works out by itself whether the board is in bootloader.
        const inBootloader = status === "waiting";
        log(`Flashing ${target.asset} (${tag}) to ${target.label}`, "warn");

        let flashPort: SerialPort | null = null; // for the CH340 driver hint on failure
        try {
            const port = await beforeFlash();
            flashPort = port;

            // Serial-based flashing (and the 1200 baud reset) can reuse the port
            // Chords was just using instead of asking the user to pick it again.
            if (port && (needsApi(device) === "serial" || device.touch1200) && !inBootloader) {
                setPreferredSerialPort(port);
            }

            // Usually already downloaded by the prefetch: the browser only opens
            // the USB picker shortly after a click, so this mustn't wait on the network.
            const firmwareFile = await getFirmwareFile(tag, target.asset);

            // STM32: forget every boot device remembered from earlier, so the
            // picker only offers what's plugged in now and no old entry is reused.
            const isStm32 = device.protocol === "dfuse" && !device.touch1200;
            if (isStm32) {
                // Its normal (serial) port disappears in boot mode; if it's still
                // there, the picker would have nothing real to offer.
                const stillRunning = (await navigator.serial.getPorts()).some(
                    (p) => p.getInfo().usbVendorId === 0x0483 && p.getInfo().usbProductId === usbProductId
                );
                if (stillRunning) {
                    throw new Error(
                        "The board is still in normal mode. Put it in boot mode (hold BOOT0, tap NRST, release BOOT0), then press Flash."
                    );
                }
                await forgetBootDevices(device.usbFilters ?? []);
            }

            await flashDevice(
                {
                    device,
                    file: firmwareFile,
                    customAddress: device.firmware[0].address,
                    verify: true,
                    skipTouch: inBootloader,
                },
                {
                    log: (m) => log(m),
                    progress: (pct, label) =>
                        setProgress({ pct: Math.max(0, Math.min(100, pct)), label: label ?? "" }),
                }
            );
            setProgress({ pct: 100, label: "Done" });
            // ...and forget this one too once it has left boot mode.
            if (isStm32) await forgetBootDevices(device.usbFilters ?? []);
            setStatus("done");
            log("Firmware updated successfully.", "ok");
            toast.success("Firmware updated", { description: `${target.label} is now on ${tag}. Reconnecting…` });
            // Let the success show briefly, then close and hand over to the reconnect.
            setTimeout(() => {
                onOpenChange(false);
                onFlashed();
            }, 800);
        } catch (e) {
            setProgress(null);
            if (e instanceof NeedsUserGesture) {
                // The board rebooted into its bootloader; the browser needs a
                // fresh click before it can show the USB device picker.
                setStatus("waiting");
                log(e.message, "warn");
            } else {
                const msg = e instanceof Error ? e.message : String(e);
                const cancelled = /No port selected|No device selected|NotFoundError|aborted a request/i.test(msg);
                setStatus("error");
                log(cancelled ? "Cancelled: no device was selected." : `Error: ${msg}`, "err");
                if (cancelled) toast.message("Flashing cancelled: no device was selected.");
                else {
                    toast.error("Firmware update failed", { description: msg });
                    // Clone boards: a missing CH340 driver is a common cause.
                    if (isCh340(flashPort?.getInfo()) || target.device.id.includes("clone")) {
                        showCh340DriverToast("Couldn't flash the board");
                    }
                }
            }
        } finally {
            setPreferredSerialPort(null);
        }
    };

    const flashLabel =
        status === "flashing" ? "Flashing…" : status === "waiting" ? "Continue" : status === "error" ? "Try again" : "Flash firmware";

    return (
        <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
            <DialogContent className="max-w-lg" onInteractOutside={(e) => busy && e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle>Your firmware is not updated</DialogTitle>
                    <DialogDescription>
                        The device didn&apos;t identify itself, so it was detected by its USB ID.{" "}
                        {latest ? (
                            <>
                                Update it to the latest firmware:{" "}
                                <a href={latest.html_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                                    {latest.tag}
                                </a>
                            </>
                        ) : latestError ? (
                            <span className="text-destructive">{latestError}</span>
                        ) : (
                            "Checking for the latest firmware…"
                        )}
                    </DialogDescription>
                </DialogHeader>

                {targets.length === 0 ? (
                    <p className="text-sm">
                        This board can&apos;t be updated from here. Please flash the firmware from{" "}
                        <a
                            className="font-semibold text-primary hover:underline"
                            href="https://github.com/Amanmahe/Chords-Arduino-Firmware/releases/latest"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            the latest release
                        </a>
                        .
                    </p>
                ) : (
                    <div className="flex min-w-0 flex-col gap-4">
                        {targets.length > 1 && (status === "idle" || status === "error") && (
                            <div className="flex flex-col gap-2">
                                <p className="text-sm font-medium">Several boards share this USB ID. Which one is yours?</p>
                                <div className="flex flex-col gap-1">
                                    {targets.map((t, i) => (
                                        <label
                                            key={t.device.id}
                                            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${i === selected ? "border-primary bg-primary/10" : "border-border"} ${busy ? "pointer-events-none opacity-60" : ""}`}
                                        >
                                            <input
                                                type="radio"
                                                name="flash-target"
                                                checked={i === selected}
                                                onChange={() => {
                                                    setSelected(i);
                                                    setStatus("idle");
                                                }}
                                                className="accent-primary"
                                            />
                                            <span className="font-medium">{t.label}</span>
                                            <span className="ml-auto truncate text-xs text-muted-foreground">{t.asset}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {target && (
                            <div className="rounded-md bg-muted p-3 text-sm">
                                <p className="mb-1 font-medium">{target.label}</p>
                                <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                                    {target.device.instructions.map((step) => (
                                        <li key={step}>{step}</li>
                                    ))}
                                </ol>
                            </div>
                        )}

                        {assetMissing && (
                            <p className="text-sm text-destructive">
                                {target.asset} isn&apos;t in release {latest?.tag}.
                            </p>
                        )}

                        {progress && (
                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>{progress.label}</span>
                                    <span>{Math.round(progress.pct)}%</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-muted">
                                    <div className="h-full bg-primary transition-all" style={{ width: `${progress.pct}%` }} />
                                </div>
                            </div>
                        )}

                        {logs.length > 0 && (
                            <div
                                ref={logRef}
                                className="max-h-40 overflow-y-auto rounded-md border bg-background p-2 font-mono text-xs [scrollbar-width:thin] [scrollbar-color:hsl(var(--muted-foreground)/0.4)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-track]:bg-transparent"
                            >
                                {logs.map((l, i) => (
                                    <div
                                        key={i}
                                        className={
                                            l.kind === "err"
                                                ? "text-destructive"
                                                : l.kind === "ok"
                                                    ? "text-green-600 dark:text-green-400"
                                                    : l.kind === "warn"
                                                        ? "text-amber-600 dark:text-amber-400"
                                                        : "text-muted-foreground"
                                        }
                                    >
                                        {l.msg}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2">
                    {status === "done" ? null : (
                        <>
                            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            {target && (
                                <Button disabled={busy || assetMissing} onClick={runFlash}>
                                    {flashLabel}
                                </Button>
                            )}
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
