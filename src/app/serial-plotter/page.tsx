"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { WebglPlot, WebglLine, ColorRGBA } from "webgl-plot";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/Navbar";
import { toast } from "sonner";

interface DataPoint {
    time: number;
    values: number[];
}

const channelColors = ["#F5A3B1", "#86D3ED", "#7CD6C8", "#C2B4E2", "#48d967", "#FFFF8C"];

const SerialPlotter = () => {
    const maxChannels = 2;
    const [data, setData] = useState<DataPoint[]>([]);
    const [data2, setData2] = useState<DataPoint[]>([]);
    const [port, setPort] = useState<SerialPort | null>(null);
    const [reader, setReader] = useState<ReadableStreamDefaultReader | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [rawData, setRawData] = useState<string>("");
    const [selectedChannels, setSelectedChannels] = useState<number[]>(Array.from({ length: maxChannels }, (_, i) => i));
    const [showCombined, setShowCombined] = useState(true);
    const [showPlotterData, setShowPlotterData] = useState(false);
    const selectedChannelsRef = useRef<number[]>([]);
    const rawDataRef = useRef<HTMLDivElement | null>(null);
    const maxPoints = 1000;
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const wglpRef = useRef<WebglPlot | null>(null);
    const linesRef = useRef<WebglLine[]>([]);
    const [showCommandInput, setShowCommandInput] = useState(false);
    const [command, setCommand] = useState("");
    const [boardName, setBoardName] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<"monitor" | "plotter" | "both">("both");
    const baudRateref = useRef<number>(115200);
    const bitsref = useRef<number>(10);
    const channelsref = useRef<number>(1);
    const sweepPositions = useRef<number[]>(new Array(maxChannels).fill(0));
    const SYNC_BYTE_1 = 0xC7;
    const SYNC_BYTE_2 = 0x7C;
    const blockSize = 9;
    const maxSamples = 256;
    const shouldResetPlot = useRef(true);

    // Track if we're receiving comma-separated data
    const isCommaData = useRef(false);

    useEffect(() => {
        if (rawDataRef.current) {
            rawDataRef.current.scrollTop = rawDataRef.current.scrollHeight;
        }
    }, [rawData]);

    const maxRawDataLines = 1000;

    function testWebGLShaderSupport(gl: WebGLRenderingContext) {
        const vertexShader = gl.createShader(gl.VERTEX_SHADER);
        if (!vertexShader) {
            console.error("Failed to create vertex shader");
            return false;
        }
        gl.shaderSource(vertexShader, "attribute vec4 position; void main() { gl_Position = position; }");
        gl.compileShader(vertexShader);
        if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
            console.error("WebGL shader compilation failed:", gl.getShaderInfoLog(vertexShader));
            return false;
        }
        return true;
    }

    useEffect(() => {
        if (!canvasRef.current || selectedChannels.length === 0) return;

        const canvas = canvasRef.current;
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;

        const gl = canvas.getContext("webgl");
        if (!gl || !testWebGLShaderSupport(gl)) {
            console.error("WebGL shader support check failed.");
            return;
        }

        const wglp = new WebglPlot(canvas);
        wglpRef.current = wglp;

        // Clear old lines
        linesRef.current = [];

        // Create lines for both datasets if comma data is detected
        const numLines = isCommaData.current ? 2 : 1;
        
        for (let i = 0; i < numLines; i++) {
            const line = new WebglLine(getLineColor(i), maxPoints);
            line.lineSpaceX(-1, 2 / maxPoints);
            wglp.addLine(line);
            linesRef.current.push(line);
        }

        wglp.update();
    }, [selectedChannels, isCommaData.current]);

    useEffect(() => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;

        if ((viewMode === "both" || viewMode === "plotter") && showPlotterData) {
            const wglp = new WebglPlot(canvas);
            wglpRef.current = wglp;

            // Clear and re-add lines
            linesRef.current = [];

            // Create lines for both datasets if comma data is detected
            const numLines = isCommaData.current ? 2 : 1;
            
            for (let i = 0; i < numLines; i++) {
                const line = new WebglLine(getLineColor(i), maxPoints);
                line.lineSpaceX(-1, 2 / maxPoints);
                wglp.addLine(line);
                linesRef.current.push(line);
            }

            // Re-plot existing data
            updateWebGLPlot(data, data2);
            wglp.update();
        } else {
            wglpRef.current = null;
        }
    }, [selectedChannels, showCombined, data, data2, viewMode, showPlotterData, isCommaData.current]);

    const getLineColor = (index: number): ColorRGBA => {
        const hex = channelColors[index % channelColors.length];
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return new ColorRGBA(r, g, b, 1);
    };

    // const connectToSerial = useCallback(async () => {
    //     try {
    //         const ports = await (navigator as any).serial.getPorts();
    //         let selectedPort = ports.length > 0 ? ports[0] : null;

    //         if (!selectedPort) {
    //             selectedPort = await (navigator as any).serial.requestPort();
    //         }

    //         await selectedPort.open({ baudRate: baudRateref.current });
    //         setRawData("");
    //         setData([]);
    //         setData2([]);
    //         setPort(selectedPort);
    //         setIsConnected(true);
    //         wglpRef.current = null;
    //         linesRef.current = [];
    //         selectedChannelsRef.current = [];
    //         isCommaData.current = false;
    //         readSerialData(selectedPort);

    //         setTimeout(() => {
    //             sweepPositions.current = new Array(maxChannels).fill(0);
    //             setShowPlotterData(true);
    //         }, 4000);
    //     } catch (err) {
    //         console.error("Error connecting to serial:", err);
    //     }
    // }, [baudRateref.current]);


     const connectToSerial = useCallback(async () => {
        try {
            const ports = await (navigator as any).serial.getPorts();
            let selectedPort = ports.length > 0 ? ports[0] : null;

            if (!selectedPort) {
                selectedPort = await (navigator as any).serial.requestPort();
            }

            await selectedPort.open({ baudRate: baudRateref.current });
            setRawData("");
            setData([]);
            setData2([]);
            setPort(selectedPort);
            setIsConnected(true);
            wglpRef.current = null;
            linesRef.current = [];
            selectedChannelsRef.current = [];
            isCommaData.current = false;
            
            // Reset plot state
            shouldResetPlot.current = true;
            sweepPositions.current = new Array(maxChannels).fill(0);
            
            readSerialData(selectedPort);

            setTimeout(() => {
                sweepPositions.current = new Array(maxChannels).fill(0);
                setShowPlotterData(true);
            }, 4000);
        } catch (err) {
            console.error("Error connecting to serial:", err);
        }
    }, [baudRateref.current]);
    const readSerialData = async (serialPort: SerialPort) => {
        const READ_TIMEOUT = 5000;
        const BATCH_SIZE = 10;

        try {
            const serialReader = serialPort.readable?.getReader();
            if (!serialReader) return;
            setReader(serialReader);

            let buffer = "";
            let receivedData = false;

            const timeoutId = setTimeout(() => {
                if (!receivedData) {
                    setShowCommandInput(true);
                    console.warn("No data received within timeout period");
                }
            }, READ_TIMEOUT);

            while (true) {
                try {
                    const readPromise = serialReader.read();
                    const timeoutPromise = new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error("Read timeout")), READ_TIMEOUT)
                    );

                    const { value, done } = await Promise.race([readPromise, timeoutPromise]);
                    if (done) break;
                    if (value) {
                        receivedData = true;
                        setShowCommandInput(false);

                        const decoder = new TextDecoder();
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split("\n");
                        buffer = lines.pop() || "";

                        let newData: DataPoint[] = [];
                        let newData2: DataPoint[] = [];
                        
                        for (let i = 0; i < lines.length; i += BATCH_SIZE) {
                            const batch = lines.slice(i, i + BATCH_SIZE);
                            
                            batch.forEach((line) => {
                                setRawData((prev) => {
                                    const newRawData = prev.split("\n").concat(line.trim().replace(/\s+/g, " "));
                                    return newRawData.slice(-maxRawDataLines).join("\n");
                                });

                                if (line.includes("BOARD:")) {
                                    setBoardName(line.split(":")[1].trim());
                                    setShowCommandInput(true);
                                }

                                // Check for comma-separated values
                                if (line.includes(",")) {
                                    isCommaData.current = true;
                                    const values = line.trim().split(",").map(parseFloat).filter((v) => !isNaN(v));
                                    
                                    if (values.length >= 2) {
                                        // Store first value in data
                                        newData.push({ time: Date.now(), values: [values[0]] });
                                        
                                        // Store second value in data2
                                        newData2.push({ time: Date.now(), values: [values[1]] });
                                        
                                        channelsref.current = Math.max(channelsref.current, values.length);
                                    }
                                } else {
                                    // Regular space-separated values
                                    isCommaData.current = false;
                                    const values = line.trim().split(/\s+/).map(parseFloat).filter((v) => !isNaN(v));
                                    if (values.length > 0) {
                                        newData.push({ time: Date.now(), values });
                                        channelsref.current = values.length;
                                    }
                                }

                                setSelectedChannels((prevChannels) => {
                                    const numChannels = isCommaData.current ? 2 : channelsref.current;
                                    return prevChannels.length !== numChannels
                                        ? Array.from({ length: numChannels }, (_, i) => i)
                                        : prevChannels;
                                });
                            });
                        }

                        if (newData.length > 0) {
                            setData((prev) => [...prev, ...newData].slice(-maxPoints));
                        }
                        if (newData2.length > 0) {
                            setData2((prev) => [...prev, ...newData2].slice(-maxPoints));
                        }
                    }
                } catch (error) {
                    console.error("Error reading serial data chunk:", error);
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    continue;
                }
            }

            clearTimeout(timeoutId);
            serialReader.releaseLock();
        } catch (err) {
            console.error("Error reading serial data:", err);
            setTimeout(() => {
                if (isConnected) {
                    toast("Attempting to reconnect...");
                    connectToSerial();
                }
            }, 5000);
        }
    };

    useEffect(() => {
        let isMounted = true;
        let animationFrameId: number;

        const animate = () => {
            if (!isMounted) return;
            if (wglpRef.current) {
                wglpRef.current.update();
            }
            animationFrameId = requestAnimationFrame(animate);
        };

        animationFrameId = requestAnimationFrame(animate);

        return () => {
            isMounted = false;
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    useEffect(() => {
        const checkPortStatus = async () => {
            if (port) {
                try {
                    await port.getInfo();
                } catch {
                    setIsConnected(false);
                    setPort(null);
                    console.warn("Serial device disconnected.");
                }
            }
        };

        const interval = setInterval(checkPortStatus, 3000);
        return () => clearInterval(interval);
    }, [port]);

    // const updateWebGLPlot = (newData: DataPoint[], newData2: DataPoint[]) => {
    //     if (!wglpRef.current || linesRef.current.length === 0) return;
        
    //     // Combine data for scaling calculation
    //     const allValues = [
    //         ...newData.flatMap(dp => dp.values),
    //         ...newData2.flatMap(dp => dp.values)
    //     ];
        
    //     if (allValues.length === 0) return;
        
    //     const yMin = Math.min(...allValues);
    //     const yMax = Math.max(...allValues);
    //     const yRange = yMax - yMin || 1;

    //     // Plot first dataset (line 0)
    //     newData.forEach((dataPoint) => {
    //         if (linesRef.current[0] && dataPoint.values.length > 0) {
    //             const yValue = Math.max(-1, Math.min(1, ((dataPoint.values[0] - yMin) / yRange) * 2 - 1));
                
    //             if (sweepPositions.current[0] === undefined) {
    //                 sweepPositions.current[0] = 0;
    //             }

    //             const currentPos = sweepPositions.current[0] % maxPoints;
    //             if (!Number.isNaN(currentPos)) {
    //                 try {
    //                     linesRef.current[0].setY(currentPos, yValue);
    //                 } catch (error) {
    //                     console.error(`Error plotting data for line 0 at position ${currentPos}:`, error);
    //                 }
    //             }
    //             sweepPositions.current[0] = (currentPos + 1) % maxPoints;
    //         }
    //     });

    //     // Plot second dataset (line 1) if comma data is detected
    //     if (isCommaData.current && linesRef.current[1]) {
    //         newData2.forEach((dataPoint) => {
    //             if (dataPoint.values.length > 0) {
    //                 const yValue = Math.max(-1, Math.min(1, ((dataPoint.values[0] - yMin) / yRange) * 2 - 1));
                    
    //                 if (sweepPositions.current[1] === undefined) {
    //                     sweepPositions.current[1] = 0;
    //                 }

    //                 const currentPos = sweepPositions.current[1] % maxPoints;
    //                 if (!Number.isNaN(currentPos)) {
    //                     try {
    //                         linesRef.current[1].setY(currentPos, yValue);
    //                     } catch (error) {
    //                         console.error(`Error plotting data for line 1 at position ${currentPos}:`, error);
    //                     }
    //                 }
    //                 sweepPositions.current[1] = (currentPos + 1) % maxPoints;
    //             }
    //         });
    //     }

    //     requestAnimationFrame(() => {
    //         if (wglpRef.current) wglpRef.current.update();
    //     });
    // };

     const updateWebGLPlot = (newData: DataPoint[], newData2: DataPoint[]) => {
        if (!wglpRef.current || linesRef.current.length === 0) return;
        
        // Combine data for scaling calculation
        const allValues = [
            ...newData.flatMap(dp => dp.values),
            ...newData2.flatMap(dp => dp.values)
        ];
        
        if (allValues.length === 0) return;
        
        const yMin = Math.min(...allValues);
        const yMax = Math.max(...allValues);
        const yRange = yMax - yMin || 1;

        // Reset plot positions if needed
        if (shouldResetPlot.current) {
            sweepPositions.current = new Array(maxChannels).fill(0);
            shouldResetPlot.current = false;
            
            // Clear all lines
            linesRef.current.forEach(line => {
                for (let i = 0; i < maxPoints; i++) {
                    line.setY(i, 0);
                }
            });
        }

        // Plot first dataset (line 0)
        newData.forEach((dataPoint) => {
            if (linesRef.current[0] && dataPoint.values.length > 0) {
                const yValue = Math.max(-1, Math.min(1, ((dataPoint.values[0] - yMin) / yRange) * 2 - 1));
                
                if (sweepPositions.current[0] === undefined) {
                    sweepPositions.current[0] = 0;
                }

                const currentPos = sweepPositions.current[0];
                
                if (!Number.isNaN(currentPos)) {
                    try {
                        linesRef.current[0].setY(currentPos, yValue);
                    } catch (error) {
                        console.error(`Error plotting data for line 0 at position ${currentPos}:`, error);
                    }
                }
                
                // Increment position and wrap around if needed
                sweepPositions.current[0] = (currentPos + 1) % maxPoints;
                
                // If we've wrapped around, reset the plot on next update
                if (sweepPositions.current[0] === 0) {
                    shouldResetPlot.current = true;
                }
            }
        });

        // Plot second dataset (line 1) if comma data is detected
        if (isCommaData.current && linesRef.current[1]) {
            newData2.forEach((dataPoint) => {
                if (dataPoint.values.length > 0) {
                    const yValue = Math.max(-1, Math.min(1, ((dataPoint.values[0] - yMin) / yRange) * 2 - 1));
                    
                    if (sweepPositions.current[1] === undefined) {
                        sweepPositions.current[1] = 0;
                    }

                    const currentPos = sweepPositions.current[1];
                    
                    if (!Number.isNaN(currentPos)) {
                        try {
                            linesRef.current[1].setY(currentPos, yValue);
                        } catch (error) {
                            console.error(`Error plotting data for line 1 at position ${currentPos}:`, error);
                        }
                    }
                    
                    // Increment position and wrap around if needed
                    sweepPositions.current[1] = (currentPos + 1) % maxPoints;
                    
                    // If we've wrapped around, reset the plot on next update
                    if (sweepPositions.current[1] === 0) {
                        shouldResetPlot.current = true;
                    }
                }
            });
        }

        requestAnimationFrame(() => {
            if (wglpRef.current) wglpRef.current.update();
        });
    };
    const disconnectSerial = async () => {
        if (reader) {
            await reader.cancel();
            reader.releaseLock();
            setReader(null);
        }
        if (port) {
            await port.close();
            setPort(null);
        }
        setData([]);
        setData2([]);
        setIsConnected(false);
        setShowPlotterData(false);
        isCommaData.current = false;

        if (wglpRef.current) {
            wglpRef.current.clear();
            wglpRef.current = null;
        }
        linesRef.current = [];
    };

    const handleBaudRateChange = async (newBaudRate: number) => {
        if (isConnected && port) {
            await disconnectSerial();
        }
        baudRateref.current = newBaudRate;
        setTimeout(() => {
            connectToSerial();
        }, 500);
    };

    const sendCommand = async () => {
        if (!port?.writable || !command.trim()) return;

        try {
            const writer = port.writable.getWriter();
            await writer.write(new TextEncoder().encode(command + "\n"));
            writer.releaseLock();
        } catch (err) {
            console.error("Error sending command:", err);
        }
    };

    return (
        <div className="w-full h-screen mx-auto border rounded-2xl shadow-xl flex flex-col gap- overflow-hidden px-4">
            <Navbar isDisplay={true} />

            <div className="w-full flex flex-col gap-2 flex-grow overflow-hidden">
                {viewMode !== "monitor" && (
                    <div className="w-full flex flex-col flex-grow min-h-[40vh]">
                        <div className="border rounded-xl shadow-lg bg-[#1a1a2e] p-2 w-full h-full flex flex-col">
                            <div className="canvas-container w-full h-full flex items-center justify-center overflow-hidden">
                                <canvas ref={canvasRef} className="w-full h-full rounded-xl" />
                            </div>
                        </div>
                    </div>
                )}
                {viewMode !== "plotter" && (
                    <div
                        ref={rawDataRef}
                        className="w-full border rounded-xl shadow-lg bg-[#1a1a2e] text-white overflow-auto flex flex-col"
                        style={{
                            height: viewMode === "monitor" ? "calc(100vh - 100px)" : "35vh",
                            maxHeight: viewMode === "monitor" ? "calc(100vh - 100px)" : "35vh",
                            minHeight: "35vh",
                        }}
                    >
                        <div className="sticky top-0 flex items-center justify-between bg-[#1a1a2e] p-2 z-10">
                            <input
                                type="text"
                                value={command}
                                onChange={(e) => setCommand(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        sendCommand();
                                    }
                                }}
                                placeholder="Enter command"
                                className="w-full p-2 text-xs font-semibold rounded bg-gray-800 text-white border border-gray-600"
                                style={{ height: "36px" }}
                            />
                            <div className="flex items-center space-x-2 mr-auto">
                                <Button
                                    onClick={sendCommand}
                                    className="px-4 py-2 text-xs font-semibold bg-gray-500 rounded shadow-md hover:bg-gray-500 transition ml-2"
                                    style={{ height: "36px" }}
                                >
                                    Send
                                </Button>
                                <button
                                    onClick={() => setRawData("")}
                                    className="px-4 py-2 text-xs bg-red-600 text-white rounded shadow-md hover:bg-red-700 transition"
                                    style={{ height: "36px" }}
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                        <pre className="text-xs whitespace-pre-wrap break-words px-4 pb-4 flex-grow overflow-auto rounded-xl">
                            {rawData}
                        </pre>
                    </div>
                )}
            </div>

            <footer className="flex flex-col gap-2 sm:flex-row py-2 m-2 w-full shrink-0 items-center justify-center px-2 md:px-4">
                <div className="flex justify-center">
                    <Button
                        onClick={isConnected ? disconnectSerial : connectToSerial}
                        className={`px-4 py-2 text-sm font-semibold transition rounded-xl ${isConnected ? "text-sm" : "text-sm"}`}
                    >
                        {isConnected ? "Disconnect" : "Connect"}
                    </Button>
                </div>
                <div className="flex items-center gap-0.5 mx-0 px-0">
                    {(["monitor", "plotter", "both"] as const).map((mode, index, arr) => (
                        <Button
                            key={mode}
                            onClick={() => setViewMode(mode)}
                            className={`px-4 py-2 text-sm transition font-semibold
                ${viewMode === mode
                                    ? "bg-primary text-white dark:text-gray-900 shadow-md"
                                    : "bg-gray-500 text-gray-900 hover:bg-gray-300"}
                ${index === 0 ? "rounded-xl rounded-r-none" : ""}
                ${index === arr.length - 1 ? "rounded-xl rounded-l-none" : ""}
                ${index !== 0 && index !== arr.length - 1 ? "rounded-none" : ""}`}
                        >
                            {mode.charAt(0).toUpperCase() + mode.slice(1)}
                        </Button>
                    ))}
                </div>
                <div className="flex items-center space-x-2">
                    <label className="text-sm font-semibold">Baud Rate:</label>
                    <select
                        value={baudRateref.current}
                        onChange={(e) => handleBaudRateChange(Number(e.target.value))}
                        className="p-1 border rounded bg-gray-800 text-white text-sm"
                    >
                        {[9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map((rate) => (
                            <option key={rate} value={rate}>{rate}</option>
                        ))}
                    </select>
                </div>
            </footer>
        </div>
    );
};

export default SerialPlotter;