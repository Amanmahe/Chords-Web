'use client';
import React, {
    useEffect,
    useRef,
    useState,
    useCallback,
    useMemo,
    useImperativeHandle,
    forwardRef,
    useLayoutEffect,
} from "react";
import { WebglPlot, ColorRGBA, WebglLine } from "webgl-plot";
import { useTheme } from "next-themes";

interface RepForgeProps {
    pauseRef: React.RefObject<boolean>;
    snapShotRef: React.MutableRefObject<boolean[]>;
    currentSnapshot: number;
    selectedChannels: number[];
    currentSamplingRate: number;
    timeBase?: number;
    Zoom: number;
}

class EnvelopeFilter {
    private circularBuffer: number[];
    private sum: number = 0;
    private dataIndex: number = 0;
    private readonly bufferSize: number;

    constructor(bufferSize: number) {
        this.bufferSize = bufferSize;
        this.circularBuffer = new Array(bufferSize).fill(0);
    }

    getEnvelope(absEmg: number): number {
        this.sum -= this.circularBuffer[this.dataIndex];
        this.sum += absEmg;
        this.circularBuffer[this.dataIndex] = absEmg;
        this.dataIndex = (this.dataIndex + 1) % this.bufferSize;
        return this.sum / this.bufferSize;
    }
}

// Default number of points per line (2s @ 500Hz) used until the real
// sampling rate / timeBase are known. Kept short rather than a long sweep
// window so the trace fills the full available width quickly instead of
// leaving a visible blank gap after connecting or changing channels.
const DEFAULT_NUM_POINTS = 1000;
const DEFAULT_TIME_BASE_SECONDS = 2;

const NUM_SNAPSHOT_BUFFERS = 6;

// RepForge only ever shows this many channels at once, regardless of how
// many the connected device actually supports (some boards have up to 16).
export const MAX_REPFORGE_CHANNELS = 6;

const RepForge = forwardRef(
    (
        { pauseRef, snapShotRef, currentSnapshot, selectedChannels, currentSamplingRate, timeBase = DEFAULT_TIME_BASE_SECONDS, Zoom }: RepForgeProps,
        ref
    ) => {
        // Use resolvedTheme, not theme: see the comment in Canvas.tsx.
        const { resolvedTheme: theme } = useTheme();
        const canvasContainerRef = useRef<HTMLDivElement>(null);
        // Window size in samples, kept in sync with timeBase/currentSamplingRate
        // (see the reset effect below) so the Time-Base control in the toolbar
        // actually changes how much data Rep-Forge shows, same as Chords Visualizer.
        const dataPointCountRef = useRef<number>(DEFAULT_NUM_POINTS);
        const sweepPositions = useRef<number[]>([]);
        const wglpRefs = useRef<WebglPlot[]>([]);
        const linesRefs = useRef<WebglLine[][]>([]); // [channelIndex] -> [rawLine, envelopeLine]
        const envelopeFilters = useRef<EnvelopeFilter[]>([]);
        const selectedChannelsRef = useRef<number[]>(selectedChannels);
        const previousCounterRef = useRef<number | null>(null);

        // Buffers used to remember the last few windows of raw samples per
        // channel so that pausing can step back through recent snapshots.
        // envBufferRef stores the envelope value computed live alongside each
        // raw sample, so replaying a window shows the exact same envelope
        // trace that was displayed live — not one recomputed from a filter
        // that resets to zero at the start of every window.
        const rawBufferRef = useRef<number[][][]>(
            Array.from({ length: NUM_SNAPSHOT_BUFFERS }, () => [])
        );
        const envBufferRef = useRef<number[][][]>(
            Array.from({ length: NUM_SNAPSHOT_BUFFERS }, () => [])
        );
        const activeBufferIndexRef = useRef<number>(0);
        const dataIndicesRef = useRef<number[]>([]);

        const canvasRef = useRef<HTMLCanvasElement>(null);
        const containerRef = useRef<HTMLDivElement>(null);
        const latestDataRef = useRef<number[] | null>(null);
        const animationRef = useRef<number>(0);
        const prevBandPowerData = useRef<number[]>([]);
        const [bandPowerData, setBandPowerData] = useState<number[]>([]);
        const powerBuffer = useRef<number[][]>([]);

        const bandNames = useMemo(
            () => selectedChannels.map((channelNumber) => `CH${channelNumber}`),
            [selectedChannels]
        );

        useEffect(() => {
            selectedChannelsRef.current = selectedChannels;
            envelopeFilters.current = selectedChannels.map(() => new EnvelopeFilter(64));
            powerBuffer.current = selectedChannels.map(() => []);
            const emptyBandData = selectedChannels.map(() => 0);
            setBandPowerData(emptyBandData);
            prevBandPowerData.current = emptyBandData;
            sweepPositions.current = selectedChannels.map(() => 0);

            // Keep the window size in sync with the Time-Base control (same
            // as Chords Visualizer) — falls back to the default until the
            // device's real sampling rate is known.
            dataPointCountRef.current = currentSamplingRate > 0
                ? Math.round(currentSamplingRate * timeBase)
                : DEFAULT_NUM_POINTS;

            // Changing which channels are selected, or the window size
            // (timeBase / sampling rate), invalidates every buffered
            // snapshot — a slot may hold data for a channel that's no longer
            // shown, or be sized for a different window length than buffers
            // filled afterward. Reset the pause/snapshot buffers so
            // pause/rewind never mixes stale or mismatched-length data in.
            rawBufferRef.current = Array.from({ length: NUM_SNAPSHOT_BUFFERS }, () => selectedChannels.map(() => []));
            envBufferRef.current = Array.from({ length: NUM_SNAPSHOT_BUFFERS }, () => selectedChannels.map(() => []));
            activeBufferIndexRef.current = 0;
            dataIndicesRef.current = [];
            snapShotRef.current = Array(NUM_SNAPSHOT_BUFFERS).fill(false);
        }, [selectedChannels, timeBase, currentSamplingRate, snapShotRef]);

        const createCanvasElements = useCallback(() => {
            const container = canvasContainerRef.current;
            if (!container) return;

            // Clear existing child elements
            while (container.firstChild) {
                const firstChild = container.firstChild;
                if (firstChild instanceof HTMLCanvasElement) {
                    const gl = firstChild.getContext("webgl");
                    if (gl) {
                        const loseContext = gl.getExtension("WEBGL_lose_context");
                        if (loseContext) loseContext.loseContext();
                    }
                }
                container.removeChild(firstChild);
            }

            const gridWrapper = document.createElement("div");
            gridWrapper.className = "absolute inset-0";
            const opacityDarkMajor = "0.2";
            const opacityDarkMinor = "0.05";
            const opacityLightMajor = "0.4";
            const opacityLightMinor = "0.1";
            const distanceminor = 500 * 0.04;
            const numGridLines = (500 * 4) / distanceminor;

            for (let j = 1; j < numGridLines; j++) {
                const gridLineX = document.createElement("div");
                gridLineX.className = "absolute bg-[rgb(128,128,128)]";
                gridLineX.style.width = "1px";
                gridLineX.style.height = "100%";
                gridLineX.style.left = `${((j / numGridLines) * 100).toFixed(3)}%`;
                gridLineX.style.opacity = j % 5 === 0 ? (theme === "dark" ? opacityDarkMajor : opacityLightMajor) : (theme === "dark" ? opacityDarkMinor : opacityLightMinor);
                gridWrapper.appendChild(gridLineX);
            }

            const horizontalline = 50;
            for (let j = 1; j < horizontalline; j++) {
                const gridLineY = document.createElement("div");
                gridLineY.className = "absolute bg-[rgb(128,128,128)]";
                gridLineY.style.height = "1px";
                gridLineY.style.width = "100%";
                gridLineY.style.top = `${((j / horizontalline) * 100).toFixed(3)}%`;
                gridLineY.style.opacity = j % 5 === 0 ? (theme === "dark" ? opacityDarkMajor : opacityLightMajor) : (theme === "dark" ? opacityDarkMinor : opacityLightMinor);
                gridWrapper.appendChild(gridLineY);
            }
            container.appendChild(gridWrapper);

            wglpRefs.current = [];
            linesRefs.current = [];

            selectedChannels.forEach((channelNumber, index) => {
                const canvasWrapper = document.createElement("div");
                canvasWrapper.className = "canvas-container relative flex-[1_1_0%]";

                const canvas = document.createElement("canvas");
                canvas.id = `repforge-canvas${channelNumber}`;
                canvas.width = container.clientWidth;
                canvas.height = container.clientHeight / selectedChannels.length;
                canvas.className = "w-full h-full block rounded-xl";

                const badge = document.createElement("div");
                badge.className = "absolute text-gray-500 text-sm rounded-full p-2 m-2";
                badge.innerText = `CH${channelNumber}`;

                canvasWrapper.appendChild(badge);
                canvasWrapper.appendChild(canvas);
                container.appendChild(canvasWrapper);

                const wglp = new WebglPlot(canvas);
                wglp.gScaleY = Zoom;
                wglpRefs.current[index] = wglp;

                const color1 = new ColorRGBA(1, 0, 0, 1); // Raw EMG
                const color2 = new ColorRGBA(0, 1, 1, 1); // Envelope

                const line1 = new WebglLine(color1, dataPointCountRef.current);
                line1.lineSpaceX(-1, 2 / dataPointCountRef.current);
                wglp.addLine(line1);

                const line2 = new WebglLine(color2, dataPointCountRef.current);
                line2.lineSpaceX(-1, 2 / dataPointCountRef.current);
                wglp.addLine(line2);

                linesRefs.current[index] = [line1, line2];
            });

            sweepPositions.current = selectedChannels.map(() => 0);
            // Zoom is intentionally excluded here: it's read fresh whenever
            // this does run (for another reason), but shouldn't by itself
            // trigger a full canvas recreation — that wipes the buffered
            // waveform data. The effect below already updates gScaleY on the
            // existing plots whenever Zoom changes, without recreating them.
        }, [selectedChannels, theme, timeBase, currentSamplingRate]);

        useLayoutEffect(() => {
            if (!canvasContainerRef.current) return;
            const ro = new ResizeObserver(() => {
                createCanvasElements();
            });
            ro.observe(canvasContainerRef.current);
            return () => ro.disconnect();
        }, [createCanvasElements]);

        useEffect(() => {
            createCanvasElements();
        }, [createCanvasElements]);

        useEffect(() => {
            wglpRefs.current.forEach((wglp) => {
                if (wglp) wglp.gScaleY = Zoom;
            });
        }, [Zoom]);

        // Renders whichever buffered snapshot is selected while paused, replaying
        // the raw waveform and its matching envelope + band power (mirrors Canvas).
        const updateSnapshot = useCallback((snapshotIndex: number) => {
            const bufferIndex = dataIndicesRef.current[snapshotIndex];
            if (bufferIndex === undefined) return;

            const bufferedChannels = rawBufferRef.current[bufferIndex];
            const bufferedEnvChannels = envBufferRef.current[bufferIndex];
            if (!bufferedChannels) return;

            const envValues: number[] = [];

            selectedChannelsRef.current.forEach((_channelNumber, index) => {
                const raw = bufferedChannels[index];
                // Use the envelope values captured live for this exact window,
                // rather than recomputing from a filter that would reset to
                // zero at the start of the window (a visible "ramp-up" that
                // never actually happened when this window was live).
                const envArray = bufferedEnvChannels?.[index];
                const lines = linesRefs.current[index];
                if (!raw || !raw.length || !envArray || !lines) return;
                const [line1, line2] = lines;
                if (!line1 || !line2) return;

                try {
                    // Write every point directly (NaN past the end of the buffer)
                    // rather than shiftAdd, so the paused view always shows exactly
                    // the selected snapshot instead of blending in stale live data.
                    for (let p = 0; p < line1.numPoints; p++) {
                        line1.setY(p, p < raw.length ? raw[p] : NaN);
                        line2.setY(p, p < envArray.length ? envArray[p] : NaN);
                    }
                } catch (error) {
                    console.warn(`Error replaying buffered snapshot for channel ${index}:`, error);
                }

                envValues[index] = envArray[envArray.length - 1] ?? 0;
            });

            setBandPowerData(envValues);
            wglpRefs.current.forEach((wglp) => {
                if (!wglp) return;
                wglp.gScaleY = Zoom;
                wglp.update();
            });
        }, [Zoom]);

        const animate = useCallback(() => {
            if (!pauseRef.current) {
                updateSnapshot(currentSnapshot);
            } else {
                wglpRefs.current.forEach((wglp) => wglp && wglp.update());
                requestAnimationFrame(animate);
            }
        }, [pauseRef.current, currentSnapshot, updateSnapshot]);

        useEffect(() => {
            const frame = requestAnimationFrame(animate);
            return () => cancelAnimationFrame(frame);
        }, [animate]);

        const drawGraph = useCallback(
            (data: number[]) => {
                const canvas = canvasRef.current;
                const container = containerRef.current;
                if (!canvas || !container) return;
                if (data.some(isNaN) || data.length === 0) return;

                container.style.display = 'block';
                const { width: cssW, height: cssH } = container.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;

                if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
                    canvas.width = Math.floor(cssW * dpr);
                    canvas.height = Math.floor(cssH * dpr);
                    canvas.style.width = `${cssW}px`;
                    canvas.style.height = `${cssH}px`;
                }

                const ctx = canvas.getContext("2d");
                if (!ctx) return;

                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.scale(dpr, dpr);
                ctx.clearRect(0, 0, cssW, cssH);

                const W = cssW;
                const H = cssH;

                const barCount = data.length;

                // Scale padding/gap/radius/font against the panel's width at
                // MAX_REPFORGE_CHANNELS, not its actual current width — the
                // panel itself shrinks as fewer channels are selected (so
                // each bar keeps a fixed width), but that shouldn't also
                // shrink the gap between bars or the padding around them;
                // everything should look exactly like the 6-channel case.
                const equivalentWidthAtMaxChannels = W * (MAX_REPFORGE_CHANNELS / barCount);
                const scale = equivalentWidthAtMaxChannels / 800;
                const padding = 5 * scale;

                const availableWidth = W - (padding * 2);
                // Bars always divide up the full available width evenly: one
                // selected channel gets the whole width, two split it evenly, etc.
                // The gap between bars is a fixed pixel amount (not a fraction of
                // the per-bar width), so the bar group always occupies the same
                // total width — whether there's 1 channel or MAX_REPFORGE_CHANNELS.
                const barGap = barCount > 1 ? 8 * scale : 0;
                const barSpace = barGap;
                const barActW = (availableWidth - barGap * (barCount - 1)) / barCount;

                const axisGap = Math.max(1 * scale, 1);
                let labelBoxH = 40 * scale;

                const barAreaH = H - padding * 2 - labelBoxH - axisGap;

                if (H < 600) {
                    labelBoxH *= 0.8;
                }

                // The channel pill overlaid near the top of the bar (the bar
                // keeps drawing behind it) is sized off the label box height,
                // and the bottom value label is capped against each bar's
                // width so neither ever grows past the box or overlaps its
                // neighbors when there are many bars.
                const pillHeight = Math.max(Math.min(barAreaH * 0.09, 28 * scale), 16);
                const pillFontLabel = Math.max(Math.min(pillHeight * 0.45, barActW * 0.2), 10);
                const baseFontLabel = Math.max(Math.min(labelBoxH * 0.35, barActW * 0.18), 10);
                // With only one bar there's plenty of spare room, so size the
                // value up a bit rather than leaving it at the multi-bar size.
                const fontLabel = barCount === 1 ? baseFontLabel * 1.25 : baseFontLabel;

                const axisColor = theme === "dark" ? "#fff" : "#000";
                const bgColor = theme === "dark" ? "#020817" : "#fff";
                const radius = 15 * scale;

                data.forEach((v, i) => {
                    if (!powerBuffer.current[i]) powerBuffer.current[i] = [];
                    if (powerBuffer.current[i].length >= 500) powerBuffer.current[i].shift();
                    powerBuffer.current[i].push(v);
                });

                const totalBarsWidth = barCount * barActW + (barCount - 1) * barSpace;
                const barsLeftMargin = Math.max(0, (W - totalBarsWidth) / 2);

                data.forEach((v, i) => {
                    const adjustedBarPosition = barsLeftMargin + i * (barActW + barSpace);
                    const x0 = Math.min(adjustedBarPosition, W - padding - barActW);
                    const barY = padding;

                    ctx.fillStyle = bgColor;
                    ctx.strokeStyle = axisColor;
                    ctx.lineWidth = 1;

                    ctx.beginPath();
                    ctx.roundRect(x0, barY, barActW, barAreaH, [radius, radius, 0, 0]);
                    ctx.fill();
                    ctx.stroke();

                    const max = Math.max(...(powerBuffer.current[i] || [1]), 1);
                    const bh = (v / max) * barAreaH;
                    const barTopY = barY + (barAreaH - bh);

                    const grad = ctx.createLinearGradient(x0, barY + barAreaH, x0, barY + barAreaH - bh);
                    const one3 = barAreaH / 3;

                    if (bh <= one3) {
                        grad.addColorStop(0, "green");
                        grad.addColorStop(1, "green");
                    } else if (bh <= one3 * 2) {
                        grad.addColorStop(0, "green");
                        grad.addColorStop(one3 / bh, "green");
                        grad.addColorStop(1, "yellow");
                    } else {
                        grad.addColorStop(0, "green");
                        grad.addColorStop(one3 / bh, "green");
                        grad.addColorStop((one3 * 2) / bh, "yellow");
                        grad.addColorStop(1, "red");
                    }

                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.roundRect(x0, barTopY, barActW, bh);
                    ctx.fill();
                });

                // Channel pill, overlaid near the top of each bar rather than
                // reserved in a separate box — the bar keeps rendering in
                // full behind it, this just floats on top (same idea as the
                // "CH1"/"CH2" badges on the raw waveform panel).
                data.forEach((_v, i) => {
                    const adjustedBarPosition = barsLeftMargin + i * (barActW + barSpace);
                    const x0 = Math.min(adjustedBarPosition, W - padding - barActW);
                    const barY = padding;

                    const channelNumber = bandNames[i]?.replace(/^CH/i, "") ?? i + 1;
                    const labelText = `CH${channelNumber}`;

                    ctx.font = `bold ${pillFontLabel}px Arial`;
                    const textWidth = ctx.measureText(labelText).width;
                    const pillPaddingX = 8 * scale;
                    const pillWidth = Math.min(textWidth + pillPaddingX * 2, barActW - 4 * scale);
                    const pillMarginTop = 6 * scale;
                    const pillX = x0 + barActW / 2 - pillWidth / 2;
                    const pillY = barY + pillMarginTop;

                    ctx.fillStyle = bgColor;
                    ctx.strokeStyle = axisColor;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.roundRect(pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
                    ctx.fill();
                    ctx.stroke();

                    ctx.fillStyle = axisColor;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(labelText, pillX + pillWidth / 2, pillY + pillHeight / 2);
                });

                // Current-value box below each bar — channel identity now
                // lives in the pill above, so this only shows the number.
                data.forEach((v, i) => {
                    const adjustedBarPosition = barsLeftMargin + i * (barActW + barSpace);
                    const x0 = Math.min(adjustedBarPosition, W - padding - barActW);

                    const labelX = x0 + barActW / 2;
                    const labelY = padding + barAreaH + axisGap;

                    ctx.fillStyle = bgColor;
                    ctx.strokeStyle = axisColor;

                    ctx.beginPath();
                    ctx.roundRect(labelX - barActW / 2, labelY, barActW, labelBoxH, [0, 0, radius / 2, radius / 2]);
                    ctx.fill();
                    ctx.stroke();

                    ctx.fillStyle = axisColor;
                    ctx.font = `bold ${fontLabel}px Arial`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(v.toFixed(2), labelX, labelY + labelBoxH / 2);
                });
            },
            [theme, bandNames]
        );

        const animateGraph = useCallback(() => {
            const interpolationFactor = 0.1;

            const currentValues = bandPowerData.map((target, i) => {
                const prev = prevBandPowerData.current[i] ?? 0;
                return prev + (target - prev) * interpolationFactor;
            });

            drawGraph(currentValues);
            prevBandPowerData.current = currentValues;
            latestDataRef.current = currentValues;

            animationRef.current = requestAnimationFrame(animateGraph);
        }, [bandPowerData, drawGraph]);

        useEffect(() => {
            animationRef.current = requestAnimationFrame(animateGraph);
            return () => {
                if (animationRef.current) cancelAnimationFrame(animationRef.current);
            };
        }, [animateGraph]);

        useEffect(() => {
            const resizeObserver = new ResizeObserver(() => {
                if (animationRef.current) cancelAnimationFrame(animationRef.current);
                animationRef.current = requestAnimationFrame(animateGraph);
            });

            if (containerRef.current) resizeObserver.observe(containerRef.current);
            return () => resizeObserver.disconnect();
        }, [animateGraph]);

        // Buffers the raw samples (and their live-computed envelope) into the
        // currently active snapshot slot, flipping to the next slot once it's
        // full (mirrors the Canvas component's approach).
        const processBufferedData = useCallback((data: number[], envValues: number[]) => {
            const currentSelectedChannels = selectedChannelsRef.current;
            const currentBuffer = rawBufferRef.current[activeBufferIndexRef.current];
            const currentEnvBuffer = envBufferRef.current[activeBufferIndexRef.current];

            currentSelectedChannels.forEach((channelNumber, i) => {
                if (!currentBuffer[i]) currentBuffer[i] = [];
                if (!currentEnvBuffer[i]) currentEnvBuffer[i] = [];
                currentBuffer[i].push(data[channelNumber]);
                currentEnvBuffer[i].push(envValues[i]);
            });

            if (currentBuffer[0] && currentBuffer[0].length >= dataPointCountRef.current) {
                snapShotRef.current[activeBufferIndexRef.current] = true;
                activeBufferIndexRef.current = (activeBufferIndexRef.current + 1) % NUM_SNAPSHOT_BUFFERS;
                snapShotRef.current[activeBufferIndexRef.current] = false;
                rawBufferRef.current[activeBufferIndexRef.current] = currentSelectedChannels.map(() => []);
                envBufferRef.current[activeBufferIndexRef.current] = currentSelectedChannels.map(() => []);
            }

            // Indices of the 5 *complete* previous windows, oldest excluded and
            // the still-filling active slot excluded — index 0 is the most
            // recently completed window, not the one currently being written.
            dataIndicesRef.current = Array.from(
                { length: 5 },
                (_, i) => (activeBufferIndexRef.current - i - 1 + NUM_SNAPSHOT_BUFFERS) % NUM_SNAPSHOT_BUFFERS
            );
        }, [snapShotRef]);

        useImperativeHandle(
            ref,
            () => ({
                updateData(data: number[]) {
                    // While paused, ignore incoming live data entirely; the display
                    // is instead driven by whichever buffered snapshot is selected.
                    if (!pauseRef.current) return;

                    const currentSelectedChannels = selectedChannelsRef.current;
                    const envValues: number[] = [];

                    currentSelectedChannels.forEach((channelNumber, index) => {
                        const lines = linesRefs.current[index];
                        if (!lines) return;
                        const [line1, line2] = lines;
                        if (!line1 || !line2) return;

                        const rawValue = data[channelNumber];

                        if (sweepPositions.current[index] === undefined) {
                            sweepPositions.current[index] = 0;
                        }
                        const currentPos = sweepPositions.current[index] % line1.numPoints;

                        if (!envelopeFilters.current[index]) {
                            envelopeFilters.current[index] = new EnvelopeFilter(64);
                        }
                        const envValue = envelopeFilters.current[index].getEnvelope(Math.abs(rawValue));
                        envValues[index] = envValue;

                        try {
                            line1.setY(currentPos, rawValue);
                            line2.setY(currentPos, envValue);
                        } catch (error) {
                            console.warn(`Error plotting data for line ${index} at position ${currentPos}:`, error);
                        }

                        const clearPosition = Math.ceil((currentPos + dataPointCountRef.current / 100) % line1.numPoints);
                        try {
                            line1.setY(clearPosition, NaN);
                            line2.setY(clearPosition, NaN);
                        } catch (error) {
                            console.warn(`Error clearing data at position ${clearPosition} for line ${index}:`, error);
                        }

                        sweepPositions.current[index] = (currentPos + 1) % line1.numPoints;
                    });

                    setBandPowerData(envValues);
                    processBufferedData(data, envValues);

                    if (previousCounterRef.current !== null) {
                        const expectedCounter = (previousCounterRef.current + 1) % 256;
                        if (data[0] !== expectedCounter) {
                            console.warn(
                                `Data loss detected in RepForge! Previous counter: ${previousCounterRef.current}, Current counter: ${data[0]}`
                            );
                        }
                    }
                    previousCounterRef.current = data[0];
                },
            }),
            [processBufferedData, pauseRef]
        );

        // The right panel's width scales with how many channels are selected,
        // so every bar keeps the same fixed ("universal") width no matter the
        // count — that width is whatever a single bar gets when all
        // MAX_REPFORGE_CHANNELS are selected (the panel's original 1/3 share,
        // split 6 ways). The left (raw waveform) panel takes up whatever
        // width that leaves, so with 1 channel it's nearly the full width and
        // it shrinks back down as more channels are added.
        const rightPanelWidthPercent = (Math.min(selectedChannels.length, MAX_REPFORGE_CHANNELS) / MAX_REPFORGE_CHANNELS) * (100 / 3);
        const leftPanelWidthPercent = 100 - rightPanelWidthPercent;

        return (
            <div className="flex flex-row flex-1 overflow-auto relative">
                {/* Left Panel: raw EMG + envelope */}
                <main
                    style={{ width: `${leftPanelWidthPercent}%` }}
                    className="m-3 relative flex bg-highlight rounded-2xl"
                >
                    <div
                        ref={canvasContainerRef}
                        className="absolute inset-0 rounded-2xl"
                    />
                </main>

                {/* Right Panel: band power bar chart */}
                <main
                    style={{ width: `${rightPanelWidthPercent}%` }}
                    className="m-3 relative flex overflow-hidden"
                >
                    <div
                        ref={containerRef}
                        className="absolute inset-0 rounded-2xl"
                    >
                        <canvas ref={canvasRef} className="w-full h-full" />
                    </div>
                </main>
            </div>
        );
    }
);

RepForge.displayName = "RepForge";
export default RepForge;
