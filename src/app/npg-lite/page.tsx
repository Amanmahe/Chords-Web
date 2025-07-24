'use client';
import React, {
    useEffect,
    useRef,
    useState,
    useCallback,
} from "react";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { saveAs } from "file-saver";
import { WebglPlot, ColorRGBA, WebglLine } from "webgl-plot";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { EXGFilter, Notch, HighPassFilter } from '@/components/filters';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Circle,
    CircleStop,
    CircleX,
    Infinity,
    Trash2,
    Download,
    FileArchive,
    Pause,
    Play,
    CircleOff,
    ReplaceAll,
    Heart,
    Brain,
    Eye,
    BicepsFlexed,
    Settings,
    Loader
} from "lucide-react";
import { lightThemeColors, darkThemeColors, getCustomColor } from '@/components/Colors';
import { useTheme } from "next-themes";


const NPG_Ble = () => {
    const isRecordingRef = useRef<boolean>(false); // Ref to track if the device is recording
    const [isDisplay, setIsDisplay] = useState<boolean>(true); // Display state
    const [isRecord, setIsrecord] = useState<boolean>(true); // Display state
    const [isEndTimePopoverOpen, setIsEndTimePopoverOpen] = useState(false);
    const [datasets, setDatasets] = useState<any[]>([]);
    const [recordingElapsedTime, setRecordingElapsedTime] = useState<number>(0); // State to store the recording duration
    const [customTimeInput, setCustomTimeInput] = useState<string>(""); // State to store the custom stop time input
    const existingRecordRef = useRef<any | undefined>(undefined);
    const sampingrateref = useRef<number>(500);
    const recordingStartTimeRef = useRef<number>(0);
    const endTimeRef = useRef<number | null>(null); // Ref to store the end time of the recording
    const canvasElementCountRef = useRef<number>(1);
    const currentFileNameRef = useRef<string>("");
    const [isFilterPopoverOpen, setIsFilterPopoverOpen] = useState(false);
    const NUM_BUFFERS = 4;
    const recordingBuffers = Array(NUM_BUFFERS)
        .fill(null)
        .map(() => [] as number[][]);
    const [wglPlots, setWglPlots] = useState<WebglPlot[]>([]);
    const canvasContainerRef = useRef<HTMLDivElement>(null);
    const dataPointCountRef = useRef<number>(2000); // To track the calculated value
    const [canvasElements, setCanvasElements] = useState<HTMLCanvasElement[]>([]);
    const linesRef = useRef<WebglLine[]>([]);
    const sweepPositions = useRef<number[]>(new Array(6).fill(0)); // Array for sweep positions
    const currentSweepPos = useRef<number[]>(new Array(6).fill(0)); // Array for sweep positions
    const maxCanvasElementCountRef = useRef<number>(3);
    const blockCountRef = useRef<number>(10);
    const adcResRef = useRef<number>(12);
    const channelNames = Array.from({ length: maxCanvasElementCountRef.current }, (_, i) => `CH${i}`);
    const [selectedChannels, setSelectedChannels] = useState<number[]>([1]);
    const [manuallySelected, setManuallySelected] = useState(false); // New state to track manual selection
    const { theme } = useTheme(); // Current theme of the app
    const isDarkModeEnabled = theme === "dark"; // Boolean to check if dark mode is enabled
    const [isConnected, setIsConnected] = useState(false);
    const activeTheme: 'light' | 'dark' = isDarkModeEnabled ? 'dark' : 'light';
    const [isAllEnabledChannelSelected, setIsAllEnabledChannelSelected] = useState(false);
    const [isSelectAllDisabled, setIsSelectAllDisabled] = useState(false);
    const [isLoading, setIsLoading] = useState(false); // Track loading state for asynchronous operations
    const [open, setOpen] = useState(false);
    const selectedChannelsRef = useRef(selectedChannels);
    const [Zoom, SetZoom] = useState<number>(1); // Number of canvases
    const [timeBase, setTimeBase] = useState<number>(4); // To track the current index to show
    let activeBufferIndex = 0;
    const fillingindex = useRef<number>(0); // Initialize useRef with 0
    const MAX_BUFFER_SIZE = 500;
    const pauseRef = useRef<boolean>(true);
    const togglePause = () => {
        const newPauseState = !isDisplay;
        setIsDisplay(newPauseState);
        pauseRef.current = newPauseState;
    };
    const samplesReceivedRef = useRef(0);
    const createCanvasElements = () => {
        const container = canvasContainerRef.current;
        if (!container) {
            return; // Exit if the ref is null
        }

        currentSweepPos.current = new Array(maxCanvasElementCountRef.current).fill(0);
        sweepPositions.current = new Array(maxCanvasElementCountRef.current).fill(0);

        // Clear existing child elements
        while (container.firstChild) {
            const firstChild = container.firstChild;
            if (firstChild instanceof HTMLCanvasElement) {
                const gl = firstChild.getContext("webgl");
                if (gl) {
                    const loseContext = gl.getExtension("WEBGL_lose_context");
                    if (loseContext) {
                        loseContext.loseContext();
                    }
                }
            }
            container.removeChild(firstChild);
        }

        setCanvasElements([]);
        setWglPlots([]);
        linesRef.current = [];
        const newcanvasElements: HTMLCanvasElement[] = [];
        const newWglPlots: WebglPlot[] = [];
        const newLines: WebglLine[] = [];

        // Create grid lines
        const canvasWrapper = document.createElement("div");
        canvasWrapper.className = "absolute inset-0";
        const opacityDarkMajor = "0.2";
        const opacityDarkMinor = "0.05";
        const opacityLightMajor = "0.4";
        const opacityLightMinor = "0.1";
        const distanceminor = sampingrateref.current * 0.04;
        const numGridLines = (500 * 4) / distanceminor;

        for (let j = 1; j < numGridLines; j++) {
            const gridLineX = document.createElement("div");
            gridLineX.className = "absolute bg-[rgb(128,128,128)]";
            gridLineX.style.width = "1px";
            gridLineX.style.height = "100%";
            gridLineX.style.left = `${((j / numGridLines) * 100).toFixed(3)}%`;
            gridLineX.style.opacity = j % 5 === 0 ? (theme === "dark" ? opacityDarkMajor : opacityLightMajor) : (theme === "dark" ? opacityDarkMinor : opacityLightMinor);
            canvasWrapper.appendChild(gridLineX);
        }

        const horizontalline = 50;
        for (let j = 1; j < horizontalline; j++) {
            const gridLineY = document.createElement("div");
            gridLineY.className = "absolute bg-[rgb(128,128,128)]";
            gridLineY.style.height = "1px";
            gridLineY.style.width = "100%";
            gridLineY.style.top = `${((j / horizontalline) * 100).toFixed(3)}%`;
            gridLineY.style.opacity = j % 5 === 0 ? (theme === "dark" ? opacityDarkMajor : opacityLightMajor) : (theme === "dark" ? opacityDarkMinor : opacityLightMinor);
            canvasWrapper.appendChild(gridLineY);
        }
        container.appendChild(canvasWrapper);


        // Create canvasElements for each selected channel
        selectedChannels.forEach((channelNumber) => {
            const canvasWrapper = document.createElement("div");
            canvasWrapper.className = "canvas-container relative flex-[1_1_0%]";

            const canvas = document.createElement("canvas");
            canvas.id = `canvas${channelNumber}`;
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight / selectedChannels.length;
            canvas.className = "w-full h-full block rounded-xl";

            const badge = document.createElement("div");
            badge.className = "absolute text-gray-500 text-sm rounded-full p-2 m-2";
            badge.innerText = `CH${channelNumber}`;

            canvasWrapper.appendChild(badge);
            canvasWrapper.appendChild(canvas);
            container.appendChild(canvasWrapper);

            newcanvasElements.push(canvas);
            const wglp = new WebglPlot(canvas);
            newWglPlots.push(wglp);
            wglp.gScaleY = Zoom;


            const line = new WebglLine(getLineColor(channelNumber, theme), dataPointCountRef.current);
            wglp.gOffsetY = 0;
            line.offsetY = 0;
            line.lineSpaceX(-1, 2 / dataPointCountRef.current);

            wglp.addLine(line);
            newLines.push(line);
        });

        linesRef.current = newLines;
        setCanvasElements(newcanvasElements);
        setWglPlots(newWglPlots);
    };

    const getLineColor = (channelNumber: number, theme: string | undefined): ColorRGBA => {
        // Convert 1-indexed channel number to a 0-indexed index
        const index = channelNumber - 1;
        const colors = theme === "dark" ? darkThemeColors : lightThemeColors;
        const hex = colors[index % colors.length];

        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        const alpha = theme === "dark" ? 1 : 0.8;  // Slight transparency for light theme

        return new ColorRGBA(r, g, b, alpha);
    };


    const handleSelectAllToggle = () => {
        const enabledChannels = Array.from({ length: maxCanvasElementCountRef.current }, (_, i) => i + 1);

        if (!isAllEnabledChannelSelected) {
            // Programmatic selection of all channels
            setManuallySelected(false); // Mark as not manual
            setSelectedChannels(enabledChannels); // Select all channels
        } else {
            // RESET functionality
            const savedchannels = JSON.parse(localStorage.getItem('savedchannels') || '[]');
            let initialSelectedChannelsRefs: number[] = []; // Default to channel 1 if no saved channels are found

            // Get the saved channels for the device
            initialSelectedChannelsRefs = [1]; // Load saved channels or default to [1]



            // Set the channels back to saved values
            setSelectedChannels(initialSelectedChannelsRefs); // Reset to saved channels
        }

        // Toggle the "Select All" button state
        setIsAllEnabledChannelSelected((prevState) => !prevState);
    };

    const [refresh, setRefresh] = useState(0);


    useEffect(() => {
        createCanvasElements();
        setRefresh(r => r + 1);
    }, [maxCanvasElementCountRef.current, theme, timeBase, selectedChannels, Zoom, isConnected]);
    useEffect(() => {
        selectedChannelsRef.current = selectedChannels;
    }, [selectedChannels]);

    //filters
    const appliedFiltersRef = React.useRef<{ [key: number]: number }>({});
    const appliedEXGFiltersRef = React.useRef<{ [key: number]: number }>({});
    const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
    const [, forceEXGUpdate] = React.useReducer((x) => x + 1, 0);

    const removeEXGFilter = (channelIndex: number) => {
        delete appliedEXGFiltersRef.current[channelIndex]; // Remove the filter for the channel
        forceEXGUpdate(); // Trigger re-render

    };

    // Function to handle frequency selection
    const handleFrequencySelectionEXG = (channelIndex: number, frequency: number) => {
        appliedEXGFiltersRef.current[channelIndex] = frequency; // Update the filter for the channel
        forceEXGUpdate(); //Trigger re-render

    };

    // Function to set the same filter for all channels
    const applyEXGFilterToAllChannels = (channels: number[], frequency: number) => {
        channels.forEach((channelIndex) => {
            appliedEXGFiltersRef.current[channelIndex] = frequency; // Set the filter for the channel
        });
        forceEXGUpdate(); // Trigger re-render

    };
    // Function to remove the filter for all channels
    const removeEXGFilterFromAllChannels = (channels: number[]) => {
        channels.forEach((channelIndex) => {
            delete appliedEXGFiltersRef.current[channelIndex]; // Remove the filter for the channel
        });
        forceEXGUpdate(); // Trigger re-render

    };
    const removeNotchFilter = (channelIndex: number) => {
        delete appliedFiltersRef.current[channelIndex]; // Remove the filter for the channel
        forceUpdate(); // Trigger re-render
    };
    // Function to handle frequency selection
    const handleFrequencySelection = (channelIndex: number, frequency: number) => {
        appliedFiltersRef.current[channelIndex] = frequency; // Update the filter for the channel
        forceUpdate(); //Trigger re-render
    };

    // Function to set the same filter for all channels
    const applyFilterToAllChannels = (channels: number[], frequency: number) => {
        channels.forEach((channelIndex) => {
            appliedFiltersRef.current[channelIndex] = frequency; // Set the filter for the channel
        });
        forceUpdate(); // Trigger re-render
    };

    // Function to remove the filter for all channels
    const removeNotchFromAllChannels = (channels: number[]) => {
        channels.forEach((channelIndex) => {
            delete appliedFiltersRef.current[channelIndex]; // Remove the filter for the channel
        });
        forceUpdate(); // Trigger re-render
    };
    useEffect(() => {
        dataPointCountRef.current = (sampingrateref.current * timeBase);
    }, [timeBase]);
    const zoomRef = useRef(Zoom);

    const handleConfig = (event: Event) => {
        console.log("Received config packet");
        const characteristic = event.target as BluetoothRemoteGATTCharacteristicExtended;
        const value = characteristic.value;
        if (!value || value.byteLength !== 8) {
            console.log("Invalid config packet length:", value?.byteLength);
            return;
        }
        const numChannels = value.getUint16(0, true);
        const blockCount = value.getUint16(2, true);
        const sampRate = value.getUint16(4, true);
        const adcRes = value.getUint16(6, true);
        maxCanvasElementCountRef.current = numChannels;
        sampingrateref.current = sampRate;
        blockCountRef.current = blockCount;
        adcResRef.current = adcRes;
        console.log("Config received:", { numChannels: maxCanvasElementCountRef.current, sampingrateref: sampingrateref.current, blockCountRef: blockCountRef.current, adcResRef: adcResRef.current });


        console.log("Config:", { numChannels, blockCount, sampRate, adcRes });
    };
    useEffect(() => {
        zoomRef.current = Zoom;
    }, [Zoom]);

    const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
    const DATA_CHAR_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
    const CONTROL_CHAR_UUID = "0000ff01-0000-1000-8000-00805f9b34fb";

    // const SINGLE_SAMPLE_LEN = useMemo(() => maxCanvasElementCountRef.current * 2 + 1, [maxCanvasElementCountRef.current]);
    // const NEW_PACKET_LEN = useMemo(() => SINGLE_SAMPLE_LEN * 20, [SINGLE_SAMPLE_LEN]);



    let prevSampleCounter: number | null = null;
    let channelData: number[] = [];

    const notchFiltersRef = useRef<Notch[]>([]);
    const exgFiltersRef = useRef<EXGFilter[]>([]);
    const pointoneFilterRef = useRef<HighPassFilter[]>([]);

    useEffect(() => {
        // Initialize the arrays if needed
        if (notchFiltersRef.current.length !== maxCanvasElementCountRef.current) {
            notchFiltersRef.current = Array.from({ length: maxCanvasElementCountRef.current }, () => new Notch());
        }
        if (exgFiltersRef.current.length !== maxCanvasElementCountRef.current) {
            exgFiltersRef.current = Array.from({ length: maxCanvasElementCountRef.current }, () => new EXGFilter());
        }
        if (pointoneFilterRef.current.length !== maxCanvasElementCountRef.current) {
            pointoneFilterRef.current = Array.from({ length: maxCanvasElementCountRef.current }, () => new HighPassFilter());
        }

        // Configure filters
        notchFiltersRef.current.forEach((filter) => {
            filter.setbits(sampingrateref.current);
        });
        exgFiltersRef.current.forEach((filter) => {
            filter.setbits(adcResRef.current.toString(), sampingrateref.current);
        });
        pointoneFilterRef.current.forEach((filter) => {
            filter.setSamplingRate(sampingrateref.current);
        });
    }, [maxCanvasElementCountRef.current, sampingrateref.current, adcResRef.current, blockCountRef.current]);
    // Inside your component
    const processSample = useCallback((dataView: DataView): void => {
        if (dataView.byteLength !== (maxCanvasElementCountRef.current * 2 + 1)) {
            console.log("Unexpected sample length: " + dataView.byteLength);
            return;
        }

        const sampleCounter = dataView.getUint8(0);

        if (prevSampleCounter === null) {
            prevSampleCounter = sampleCounter;
        } else {
            const expected = (prevSampleCounter + 1) % 256;
            if (sampleCounter !== expected) {
                console.log(`Missing sample: expected ${expected}, got ${sampleCounter}`);
            }
            prevSampleCounter = sampleCounter;
        }

        channelData.push(sampleCounter);
        // console.log(dataView);
        console.log(maxCanvasElementCountRef.current);
        for (let channel = 0; channel < maxCanvasElementCountRef.current; channel++) {
            const sample = dataView.getInt16(1 + (channel * 2), false);
            channelData.push(
                notchFiltersRef.current[channel].process(
                    exgFiltersRef.current[channel].process(pointoneFilterRef.current[channel].process(sample), appliedEXGFiltersRef.current[channel]),
                    appliedFiltersRef.current[channel]
                )
            );
        }

        updatePlots(channelData, zoomRef.current);

        if (isRecordingRef.current) {
            const channeldatavalues = channelData
                .slice(0, canvasElementCountRef.current + 1)
                .map((value) => (value !== undefined ? value : null))
                .filter((value): value is number => value !== null);

            recordingBuffers[activeBufferIndex][fillingindex.current] = channeldatavalues;

            if (fillingindex.current >= MAX_BUFFER_SIZE - 1) {
                processBuffer(activeBufferIndex, canvasElementCountRef.current, selectedChannels);
                activeBufferIndex = (activeBufferIndex + 1) % NUM_BUFFERS;
            }

            fillingindex.current = (fillingindex.current + 1) % MAX_BUFFER_SIZE;

            const elapsedTime = Date.now() - recordingStartTimeRef.current;
            setRecordingElapsedTime((prev) => {
                if (endTimeRef.current !== null && elapsedTime >= endTimeRef.current) {
                    stopRecording();
                    return endTimeRef.current;
                }
                return elapsedTime;
            });
        }

        channelData = [];
        samplesReceivedRef.current += 1;
    }, [
        canvasElementCountRef.current, selectedChannels, timeBase
    ]);

    interface BluetoothRemoteGATTCharacteristicExtended extends EventTarget {
        value?: DataView;
    }

    const handleNotification = useCallback((event: Event): void => {
        const target = event.target as BluetoothRemoteGATTCharacteristicExtended;

        if (!target.value) {
            console.log("Received event with no value.");
            return;
        }

        if (
            currentSweepPos.current.length !== maxCanvasElementCountRef.current ||
            !pauseRef.current
        ) {
            currentSweepPos.current = new Array(maxCanvasElementCountRef.current).fill(0);
            sweepPositions.current = new Array(maxCanvasElementCountRef.current).fill(0);
        }

        const value = target.value;
        const SINGLE_SAMPLE_LEN = (maxCanvasElementCountRef.current * 2 + 1);
        const NEW_PACKET_LEN = SINGLE_SAMPLE_LEN * blockCountRef.current;
        if (value.byteLength === NEW_PACKET_LEN) {
            for (let i = 0; i < NEW_PACKET_LEN; i += SINGLE_SAMPLE_LEN) {
                const sampleBuffer = value.buffer.slice(i, i + SINGLE_SAMPLE_LEN);
                const sampleDataView = new DataView(sampleBuffer);
                processSample(sampleDataView);
            }
        } else if (value.byteLength === SINGLE_SAMPLE_LEN) {
            processSample(new DataView(value.buffer));
        } else {
            console.log("Unexpected packet length: " + value.byteLength);
        }
    }, [
        maxCanvasElementCountRef,  // if these are refs, they don't need to be in deps
        pauseRef,
        currentSweepPos,
        sweepPositions,
        processSample,
        blockCountRef, maxCanvasElementCountRef.current, sampingrateref.current, adcResRef.current, appliedFiltersRef, appliedEXGFiltersRef
    ]);



    const connectedDeviceRef = useRef<any | null>(null); // UseRef for device tracking

async function connectBLE(): Promise<void> {
    try {
        setIsLoading(true);
        const nav = navigator as any;

        if (!nav.bluetooth) {
            console.log("Web Bluetooth API is not available in this browser.");
            setIsLoading(false);
            return;
        }

        const device = await nav.bluetooth.requestDevice({
            filters: [{ namePrefix: "NPG" }],
            optionalServices: [SERVICE_UUID],
        });

        const server = await device.gatt?.connect();
        if (!server) {
            setIsLoading(false);
            return;
        }

        connectedDeviceRef.current = device;

        const service = await server.getPrimaryService(SERVICE_UUID);
        const controlChar = await service.getCharacteristic(CONTROL_CHAR_UUID);
        const dataChar = await service.getCharacteristic(DATA_CHAR_UUID);

        // Try to get config, but proceed with defaults if it fails
        try {
            console.log("Requesting config...");
            await controlChar.startNotifications();
            
            const configHandler = (event: Event) => {
                handleConfig(event);
                // Remove the listener after receiving config
                controlChar.removeEventListener("characteristicvaluechanged", configHandler);
            };
            
            controlChar.addEventListener("characteristicvaluechanged", configHandler);
            
            const encoder = new TextEncoder();
            await controlChar.writeValue(encoder.encode("CONFIG"));
            
            // Wait a short time for config response
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            console.log("Config not supported, using defaults:", error);
            // Set default values if config fails
          
        }

        // Proceed with data collection regardless of config
        try {
            const encoder = new TextEncoder();
            await controlChar.writeValue(encoder.encode("START"));
            await dataChar.startNotifications();
            dataChar.addEventListener("characteristicvaluechanged", handleNotification);
            
            setIsConnected(true);
            setIsLoading(false);
            
            // Update UI with the current configuration
            createCanvasElements();
        } catch (error) {
            console.log("Error starting data collection:", error);
            setIsLoading(false);
            toast.error("Failed to start data collection");
        }

    } catch (error) {
        console.log("Connection error:", error instanceof Error ? error.message : error);
        setIsLoading(false);
        toast.error("Connection failed");
    }
}


    async function disconnect(): Promise<void> {
        try {
            if (!connectedDeviceRef.current) {
                console.log("No connected device to disconnect.");
                return;
            }

            const server = connectedDeviceRef.current.gatt;
            if (!server) {
                return;
            }


            if (!server.connected) {
                connectedDeviceRef.current = null;
                setIsConnected(false);
                return;
            }

            const service = await server.getPrimaryService(SERVICE_UUID);
            const dataChar = await service.getCharacteristic(DATA_CHAR_UUID);
            await dataChar.stopNotifications();
            dataChar.removeEventListener("characteristicvaluechanged", handleNotification);

            server.disconnect(); // Disconnect the device

            connectedDeviceRef.current = null; // Clear the global reference
            setIsConnected(false);
        } catch (error) {
            console.log("Error during disconnection: " + (error instanceof Error ? error.message : error));
        }
    }

    const workerRef = useRef<Worker | null>(null);

    const initializeWorker = () => {
        if (!workerRef.current && typeof window !== "undefined") {
            workerRef.current = new Worker(new URL('../../../workers/indexedDBWorker.ts', import.meta.url), {
                type: 'module',
            });
        }
    };

    useEffect(() => {
        canvasElementCountRef.current = selectedChannels.length;
    }, [selectedChannels]);

    const setSelectedChannelsInWorker = (selectedChannels: number[]) => {
        if (!workerRef.current) {
            initializeWorker();
        }

        // Send selectedChannels independently to the worker
        workerRef.current?.postMessage({
            action: 'setSelectedChannels',
            selectedChannels: selectedChannels,
        });

    };

    useEffect(() => {
        setSelectedChannelsInWorker(selectedChannels);
    }, [selectedChannels]);

    const processBuffer = async (bufferIndex: number, canvasCount: number, selectChannel: number[]) => {
        if (!workerRef.current) {
            initializeWorker();
        }

        // If the buffer is empty, return early
        if (recordingBuffers[bufferIndex].length === 0) return;

        const data = recordingBuffers[bufferIndex];
        const filename = currentFileNameRef.current;

        if (filename) {
            // Check if the record already exists
            workerRef.current?.postMessage({ action: 'checkExistence', filename, canvasCount, selectChannel });
            writeToIndexedDB(data, filename, canvasCount, selectChannel);
        }
    };

    const writeToIndexedDB = (data: number[][], filename: string, canvasCount: number, selectChannel: number[]) => {
        workerRef.current?.postMessage({ action: 'write', data, filename, canvasCount, selectChannel });
    };

    const saveAllDataAsZip = async () => {
        try {
            if (workerRef.current) {
                workerRef.current.postMessage({
                    action: 'saveAsZip',
                    canvasElementCount: canvasElementCountRef.current, // Assign with a key
                    selectedChannels
                });

                workerRef.current.onmessage = async (event) => {
                    const { zipBlob, error } = event.data;

                    if (zipBlob) {
                        saveAs(zipBlob, 'ChordsWeb.zip');
                    } else if (error) {
                        console.error(error);
                    }
                };
            }
        } catch (error) {
            console.error('Error while saving ZIP file:', error);
        }
    };

    // Function to handle saving data by filename
    const saveDataByFilename = async (filename: string, canvasCount: number, selectChannel: number[]) => {
        if (workerRef.current) {
            workerRef.current.postMessage({ action: "saveDataByFilename", filename, canvasCount, selectChannel });
            workerRef.current.onmessage = (event) => {
                const { blob, error } = event.data;

                if (blob) {
                    saveAs(blob, filename); // FileSaver.js
                    toast.success("File downloaded successfully.");
                } else (error: any) => {
                    console.error("Worker error:", error);
                    toast.error(`Error during file download: ${error.message}`);
                }
            };

            workerRef.current.onerror = (error) => {
                console.error("Worker error:", error);
                toast.error("An unexpected worker error occurred.");
            };
        } else {
            console.error("Worker reference is null.");
            toast.error("Worker is not available.");
        }

    };

    const deleteFileByFilename = async (filename: string) => {
        if (!workerRef.current) initializeWorker();

        return new Promise<void>((resolve, reject) => {
            workerRef.current?.postMessage({ action: 'deleteFile', filename });

            workerRef.current!.onmessage = (event) => {
                const { success, action, error } = event.data;

                if (action === 'deleteFile') {
                    if (success) {
                        toast.success(`File '${filename}' deleted successfully.`);

                        setDatasets((prev) => prev.filter((file) => file !== filename)); // Update datasets
                        resolve();
                    } else {
                        console.error(`Failed to delete file '${filename}': ${error}`);
                        reject(new Error(error));
                    }
                }
            };
        });
    };

    const deleteAllDataFromIndexedDB = async () => {
        if (!workerRef.current) initializeWorker();

        return new Promise<void>((resolve, reject) => {
            workerRef.current?.postMessage({ action: 'deleteAll' });

            workerRef.current!.onmessage = (event) => {
                const { success, action, error } = event.data;

                if (action === 'deleteAll') {
                    if (success) {
                        toast.success(`All files deleted successfully.`);
                        setDatasets([]); // Clear all datasets from state
                        resolve();
                    } else {
                        console.error('Failed to delete all files:', error);
                        reject(new Error(error));
                    }
                }
            };
        });
    };

    const handleTimeSelection = (minutes: number | null) => {
        // Function to handle the time selection
        if (minutes === null) {
            endTimeRef.current = null;
            toast.success("Recording set to no time limit");
        } else {
            // If the time is not null, set the end time
            const newEndTimeSeconds = minutes * 60 * 1000;
            if (newEndTimeSeconds <= recordingElapsedTime) {
                // Check if the end time is greater than the current elapsed time
                toast.error("End time must be greater than the current elapsed time");
            } else {
                endTimeRef.current = newEndTimeSeconds; // Set the end time
                toast.success(`Recording end time set to ${minutes} minutes`);
            }
        }
    };

    const handleRecord = async () => {
        if (isRecordingRef.current) {
            // Stop the recording if it is currently active
            stopRecording();

        } else {
            // Start a new recording session
            isRecordingRef.current = true;
            const now = new Date();
            recordingStartTimeRef.current = Date.now();
            setRecordingElapsedTime(Date.now());
            setIsrecord(false);
            const filename = `ChordsWeb-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-` +
                `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.csv`;

            currentFileNameRef.current = filename;
        }
    };
    const stopRecording = async () => {
        if (!recordingStartTimeRef.current) {
            toast.error("Recording start time was not captured.");
            return;
        }
        isRecordingRef.current = false;
        setRecordingElapsedTime(0);
        setIsrecord(true);

        recordingStartTimeRef.current = 0;
        existingRecordRef.current = undefined;
        // Re-fetch datasets from IndexedDB after recording stops
        const fetchData = async () => {
            const data = await getFileCountFromIndexedDB();
            setDatasets(data); // Update datasets with the latest data
        };
        // Call fetchData after stopping the recording
        fetchData();
    };
    const getFileCountFromIndexedDB = async (): Promise<any[]> => {
        if (!workerRef.current) {
            initializeWorker();
        }

        return new Promise((resolve, reject) => {
            if (workerRef.current) {
                workerRef.current.postMessage({ action: 'getFileCountFromIndexedDB' });

                workerRef.current.onmessage = (event) => {
                    if (event.data.allData) {
                        resolve(event.data.allData);
                    } else if (event.data.error) {
                        reject(event.data.error);
                    }
                };

                workerRef.current.onerror = (error) => {
                    reject(`Error in worker: ${error.message}`);
                };
            } else {
                reject('Worker is not initialized');
            }
        });
    };

    const handlecustomTimeInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        // Update custom time input with only numeric values
        setCustomTimeInput(e.target.value.replace(/\D/g, ""));
    };

    const handlecustomTimeInputSet = () => {
        // Parse and validate the custom time input
        const time = parseInt(customTimeInput, 10);

        if (time > 0) {
            handleTimeSelection(time); // Proceed with valid time
        } else {
            toast.error("Please enter a valid time in minutes"); // Show error for invalid input
        }

        // Clear the input field after handling
        setCustomTimeInput("");
    };
    const formatTime = (milliseconds: number): string => {
        const date = new Date(milliseconds);
        const hours = String(date.getUTCHours()).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(date.getUTCSeconds()).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    };


    useEffect(() => {
        const enabledChannels = Array.from({ length: maxCanvasElementCountRef.current }, (_, i) => i + 1);

        const allSelected = selectedChannels.length === enabledChannels.length;
        const onlyOneLeft = selectedChannels.length === enabledChannels.length - 1;

        setIsSelectAllDisabled((allSelected && manuallySelected) || onlyOneLeft);

        // Update the "Select All" button state
        setIsAllEnabledChannelSelected(allSelected);
    }, [selectedChannels, maxCanvasElementCountRef.current, manuallySelected]);

    const toggleChannel = (channelIndex: number) => {
        setSelectedChannels((prevSelected) => {
            setManuallySelected(true);
            const updatedChannels = prevSelected.includes(channelIndex)
                ? prevSelected.filter((ch) => ch !== channelIndex)
                : [...prevSelected, channelIndex];

            const sortedChannels = updatedChannels.sort((a, b) => a - b);

            if (sortedChannels.length === 0) {
                sortedChannels.push(1);
            }

            return sortedChannels;
        });
    };



    const updatePlots = useCallback(
        (data: number[], Zoom: number) => {
            // Access the latest selectedChannels via the ref
            setIsLoading(false);
            setIsConnected(true);
            const currentSelectedChannels = selectedChannelsRef.current;
            // Adjust zoom level for each WebglPlot
            wglPlots.forEach((wglp, index) => {
                if (wglp) {
                    try {
                        wglp.gScaleY = zoomRef.current; // Adjust zoom value
                    } catch (error) {
                        console.error(
                            `Error setting gScaleY for WebglPlot instance at index ${index}:`,
                            error
                        );
                    }
                } else {
                    console.warn(`WebglPlot instance at index ${index} is undefined.`);
                }
            });
            linesRef.current.forEach((line, i) => {
                if (!line) {
                    console.warn(`Line at index ${i} is undefined.`);
                    return;
                }

                // Map channel number from selectedChannels
                const channelNumber = currentSelectedChannels[i];
                if (channelNumber == null || channelNumber < 0 || channelNumber >= data.length) {
                    console.warn(`Invalid channel number: ${channelNumber}. Skipping.`);
                    return;
                }

                const channelData = data[channelNumber];


                // Ensure sweepPositions.current[i] is initialized
                if (sweepPositions.current[i] === undefined) {
                    sweepPositions.current[i] = 0;
                }

                // Calculate the current position
                const currentPos = sweepPositions.current[i] % line.numPoints;

                if (Number.isNaN(currentPos)) {
                    console.error(`Invalid currentPos at index ${i}. sweepPositions.current[i]:`, sweepPositions.current[i]);
                    return;
                }

                // Plot the data
                try {
                    line.setY(currentPos, channelData);
                } catch (error) {
                    console.error(`Error plotting data for line ${i} at position ${currentPos}:`, error);
                }

                // Clear the next point for visual effect
                const clearPosition = Math.ceil((currentPos + dataPointCountRef.current / 100) % line.numPoints);
                try {
                    line.setY(clearPosition, NaN);
                } catch (error) {
                    console.error(`Error clearing data at position ${clearPosition} for line ${i}:`, error);
                }

                // Increment the sweep position
                sweepPositions.current[i] = (currentPos + 1) % line.numPoints;
            });
        },
        [linesRef, wglPlots, selectedChannelsRef, dataPointCountRef.current, sweepPositions, Zoom, zoomRef.current, timeBase]
    );

    useEffect(() => {
        const handleResize = () => {
            createCanvasElements();
        };
        window.addEventListener("resize", handleResize);
        return () => {
            window.removeEventListener("resize", handleResize);
        };
    }, [createCanvasElements]);

    const animate = useCallback(() => {
        if (pauseRef.current) {
            // If paused, show the buffered data (this part runs when paused)
            wglPlots.forEach((wglp) => wglp.update());
            requestAnimationFrame(animate); // Continue the animation loop
        }
    }, [wglPlots, pauseRef.current]);


    useEffect(() => {
        requestAnimationFrame(animate);

    }, [animate, Zoom]);



    return (
        <div className="flex flex-col h-screen m-0 p-0 bg-g ">

            <div className="bg-highlight">
                <Navbar isDisplay={true} />
            </div>            <main className=" flex flex-col flex-[1_1_0%] min-h-80 bg-highlight  rounded-2xl m-4 relative"
                ref={canvasContainerRef}
            >
            </main>
            <div className="flex-none items-center justify-center pb-4 bg-g z-10" >
                {/* Left-aligned section */}
                <div className="absolute left-4 flex items-center mx-0 px-0 space-x-1">
                    {isRecordingRef.current && (
                        <div className="flex items-center space-x-1 w-min">
                            <button className="flex items-center justify-center px-1 py-2   select-none min-w-20 bg-primary text-destructive whitespace-nowrap rounded-xl"
                            >
                                {formatTime(recordingElapsedTime)}
                            </button>
                            <Separator orientation="vertical" className="bg-primary h-9 " />
                            <div>
                                <Popover
                                    open={isEndTimePopoverOpen}
                                    onOpenChange={setIsEndTimePopoverOpen}
                                >
                                    <PopoverTrigger asChild>
                                        <Button
                                            className="flex items-center justify-center px-1 py-2   select-none min-w-10  text-destructive whitespace-nowrap rounded-xl"
                                            variant="destructive"
                                        >
                                            {endTimeRef.current === null ? (
                                                <Infinity className="h-5 w-5 text-primary" />
                                            ) : (
                                                <div className="text-sm text-primary font-medium">
                                                    {formatTime(endTimeRef.current)}
                                                </div>
                                            )}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-64 p-4 mx-4">
                                        <div className="flex flex-col space-y-4">
                                            <div className="text-sm font-medium">
                                                Set End Time (minutes)
                                            </div>
                                            <div className="grid grid-cols-4 gap-2">
                                                {[1, 10, 20, 30].map((time) => (
                                                    <Button
                                                        key={time}
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleTimeSelection(time)}
                                                    >
                                                        {time}
                                                    </Button>
                                                ))}
                                            </div>
                                            <div className="flex space-x-2 items-center">
                                                <Input
                                                    type="text"
                                                    inputMode="numeric"
                                                    pattern="[0-9]*"
                                                    placeholder="Custom"
                                                    value={customTimeInput}
                                                    onBlur={handlecustomTimeInputSet}
                                                    onKeyDown={(e) =>
                                                        e.key === "Enter" && handlecustomTimeInputSet()
                                                    }
                                                    onChange={handlecustomTimeInputChange}
                                                    className="w-20"
                                                />
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleTimeSelection(null)}
                                                >
                                                    <Infinity className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>
                    )}
                </div>

                {/* Center-aligned buttons */}
                <div className="flex gap-3 items-center justify-center">
                    {/* Connection button with tooltip */}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Popover open={open} onOpenChange={setOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            className="flex items-center gap-1 py-2 px-4 rounded-xl font-semibold"
                                            onClick={() => (isConnected ? disconnect() : connectBLE())}
                                            disabled={isLoading}
                                        >
                                            {isLoading ? (
                                                <>
                                                    <Loader size={17} className="animate-spin" />
                                                    Connecting...
                                                </>
                                            ) : isConnected ? (
                                                <>
                                                    Disconnect
                                                    <CircleX size={17} />
                                                </>
                                            ) : (
                                                <>
                                                    Connect
                                                </>
                                            )}
                                        </Button>
                                    </PopoverTrigger>

                                </Popover>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{isConnected ? "Disconnect Device" : "Connect Device"}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <div className="flex items-center gap-0.5 mx-0 px-0">

                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button className="rounded-xl " onClick={togglePause} disabled={isConnected == false || !isRecord}
                                    >
                                        {isDisplay ? (
                                            <Pause className="h-5 w-5" />
                                        ) : (
                                            <Play className="h-5 w-5" />
                                        )}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>
                                        {isDisplay ? "Pause Data Display" : "Resume Data Display"}
                                    </p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>

                    </div>

                    {/* Record button with tooltip */}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    className="rounded-xl"
                                    onClick={handleRecord}
                                    disabled={isConnected == false || !isDisplay}

                                >
                                    {isRecordingRef.current ? (
                                        <CircleStop />
                                    ) : (
                                        <Circle fill="red" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>
                                    {!isRecordingRef.current
                                        ? "Start Recording"
                                        : "Stop Recording"}
                                </p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    {/* Save/Delete data buttons with tooltip */}
                    <TooltipProvider>
                        <div className="flex">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button className="rounded-xl p-4" disabled={isConnected == false}
                                    >
                                        <FileArchive size={16} />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="p-4 text-base shadow-lg rounded-xl w-full">
                                    <div className="space-y-4">
                                        {/* List each file with download and delete actions */}
                                        {datasets.length > 0 ? (
                                            datasets.map((dataset) => (
                                                <div key={dataset} className="flex justify-between items-center">
                                                    {/* Display the filename directly */}
                                                    <span className=" mr-4">
                                                        {dataset}
                                                    </span>

                                                    <div className="flex space-x-2">
                                                        {/* Save file by filename */}
                                                        <Button
                                                            onClick={() => saveDataByFilename(dataset, canvasElementCountRef.current, selectedChannels)}
                                                            className="rounded-xl px-4"
                                                        >
                                                            <Download size={16} />
                                                        </Button>

                                                        {/* Delete file by filename */}
                                                        <Button
                                                            onClick={() => {
                                                                deleteFileByFilename(dataset);
                                                            }}
                                                            className="rounded-xl px-4"
                                                        >
                                                            <Trash2 size={16} />
                                                        </Button>

                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <p className="text-base ">No datasets available</p>
                                        )}
                                        {/* Download all as ZIP and delete all options */}
                                        {datasets.length > 0 && (
                                            <div className="flex justify-between mt-4">
                                                <Button
                                                    onClick={saveAllDataAsZip}
                                                    className="rounded-xl p-2 w-full mr-2"
                                                >
                                                    Download All as Zip
                                                </Button>
                                                <Button
                                                    onClick={deleteAllDataFromIndexedDB}
                                                    className="rounded-xl p-2 w-full"
                                                >
                                                    Delete All
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </div>
                    </TooltipProvider>
                    {/* filters */}
                    <Popover
                        open={isFilterPopoverOpen}
                        onOpenChange={setIsFilterPopoverOpen}
                    >
                        <PopoverTrigger asChild>
                            <Button
                                className="flex items-center justify-center px-3 py-2 select-none min-w-12 whitespace-nowrap rounded-xl"
                                disabled={!isDisplay}
                            >
                                Filter
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-50 p-4 mx-4 mb-2">
                            <div className="flex flex-col max-h-80 overflow-y-auto">
                                <div className="flex items-center pb-2 ">
                                    {/* Filter Name */}
                                    <div className="text-sm font-semibold w-12"><ReplaceAll size={20} /></div>
                                    {/* Buttons */}
                                    <div className="flex space-x-2">
                                        <div className="flex items-center border border-input rounded-xl mx-0 px-0">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => removeEXGFilterFromAllChannels(Array.from({ length: maxCanvasElementCountRef.current }, (_, i) => i))}
                                                className={`rounded-xl rounded-r-none border-0
                        ${Object.keys(appliedEXGFiltersRef.current).length === 0
                                                        ? "bg-red-700 hover:bg-white-500 hover:text-white text-white" // Disabled background
                                                        : "bg-white-500" // Active background
                                                    }`}
                                            >
                                                <CircleOff size={17} />
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => applyEXGFilterToAllChannels(Array.from({ length: maxCanvasElementCountRef.current }, (_, i) => i), 4)}
                                                className={`flex items-center justify-center px-3 py-2 rounded-none select-none border-0
                        ${Object.keys(appliedEXGFiltersRef.current).length === maxCanvasElementCountRef.current && Object.values(appliedEXGFiltersRef.current).every((value) => value === 4)
                                                        ? "bg-green-700 hover:bg-white-500 text-white hover:text-white" // Disabled background
                                                        : "bg-white-500" // Active background
                                                    }`}
                                            >
                                                <BicepsFlexed size={17} />
                                            </Button> <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => applyEXGFilterToAllChannels(Array.from({ length: maxCanvasElementCountRef.current }, (_, i) => i), 3)}
                                                className={`flex items-center justify-center px-3 py-2 rounded-none select-none border-0
                        ${Object.keys(appliedEXGFiltersRef.current).length === maxCanvasElementCountRef.current && Object.values(appliedEXGFiltersRef.current).every((value) => value === 3)
                                                        ? "bg-green-700 hover:bg-white-500 text-white hover:text-white" // Disabled background
                                                        : "bg-white-500" // Active background
                                                    }`}
                                            >
                                                <Brain size={17} />
                                            </Button> <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => applyEXGFilterToAllChannels(Array.from({ length: maxCanvasElementCountRef.current }, (_, i) => i), 1)}
                                                className={`flex items-center justify-center px-3 py-2 rounded-none select-none border-0
                        ${Object.keys(appliedEXGFiltersRef.current).length === maxCanvasElementCountRef.current && Object.values(appliedEXGFiltersRef.current).every((value) => value === 1)
                                                        ? "bg-green-700 hover:bg-white-500 text-white hover:text-white" // Disabled background
                                                        : "bg-white-500" // Active background
                                                    }`}
                                            >
                                                <Heart size={17} />
                                            </Button> <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => applyEXGFilterToAllChannels(Array.from({ length: maxCanvasElementCountRef.current }, (_, i) => i), 2)}
                                                className={`rounded-xl rounded-l-none border-0
                        ${Object.keys(appliedEXGFiltersRef.current).length === maxCanvasElementCountRef.current && Object.values(appliedEXGFiltersRef.current).every((value) => value === 2)
                                                        ? "bg-green-700 hover:bg-white-500 text-white hover:text-white" // Disabled background
                                                        : "bg-white-500" // Active background
                                                    }`}
                                            >
                                                <Eye size={17} />
                                            </Button>
                                        </div>
                                        <div className="flex border border-input rounded-xl items-center mx-0 px-0">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => removeNotchFromAllChannels(Array.from({ length: maxCanvasElementCountRef.current }, (_, i) => i))}
                                                className={`rounded-xl rounded-r-none border-0
                          ${Object.keys(appliedFiltersRef.current).length === 0
                                                        ? "bg-red-700 hover:bg-white-500 hover:text-white text-white" // Disabled background
                                                        : "bg-white-500" // Active background
                                                    }`}
                                            >
                                                <CircleOff size={17} />
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => applyFilterToAllChannels(Array.from({ length: maxCanvasElementCountRef.current }, (_, i) => i), 1)}
                                                className={`flex items-center justify-center px-3 py-2 rounded-none select-none border-0
                          ${Object.keys(appliedFiltersRef.current).length === maxCanvasElementCountRef.current && Object.values(appliedFiltersRef.current).every((value) => value === 1)
                                                        ? "bg-green-700 hover:bg-white-500 text-white hover:text-white" // Disabled background
                                                        : "bg-white-500" // Active background
                                                    }`}
                                            >
                                                50Hz
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => applyFilterToAllChannels(Array.from({ length: maxCanvasElementCountRef.current }, (_, i) => i), 2)}
                                                className={`rounded-xl rounded-l-none border-0
                          ${Object.keys(appliedFiltersRef.current).length === maxCanvasElementCountRef.current && Object.values(appliedFiltersRef.current).every((value) => value === 2)
                                                        ? "bg-green-700 hover:bg-white-500 text-white hover:text-white" // Disabled background
                                                        : "bg-white-500" // Active background
                                                    }`}
                                            >
                                                60Hz
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-col space-y-2">
                                    {channelNames.map((filterName, index) => (
                                        <div key={filterName} className="flex items-center">
                                            {/* Filter Name */}
                                            <div className="text-sm font-semibold w-12">{filterName}</div>
                                            {/* Buttons */}
                                            <div className="flex space-x-2">
                                                <div className="flex border border-input rounded-xl items-center mx-0 px-0">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => removeEXGFilter(index)}
                                                        className={`rounded-xl rounded-r-none border-l-none border-0
                                                        ${appliedEXGFiltersRef.current[index] === undefined
                                                                ? "bg-red-700 hover:bg-white-500 hover:text-white text-white" // Disabled background
                                                                : "bg-white-500" // Active background
                                                            }`}
                                                    >
                                                        <CircleOff size={17} />
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleFrequencySelectionEXG(index, 4)}
                                                        className={`flex items-center justify-center px-3 py-2 rounded-none select-none border-0
                                                        ${appliedEXGFiltersRef.current[index] === 4
                                                                ? "bg-green-700 hover:bg-white-500 text-white hover:text-white" // Disabled background
                                                                : "bg-white-500" // Active background
                                                            }`}
                                                    >
                                                        <BicepsFlexed size={17} />
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleFrequencySelectionEXG(index, 3)}
                                                        className={`flex items-center justify-center px-3 py-2 rounded-none select-none border-0
                                                      ${appliedEXGFiltersRef.current[index] === 3
                                                                ? "bg-green-700 hover:bg-white-500 text-white hover:text-white" // Disabled background
                                                                : "bg-white-500" // Active background
                                                            }`}
                                                    >
                                                        <Brain size={17} />
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleFrequencySelectionEXG(index, 1)}
                                                        className={`flex items-center justify-center px-3 py-2 rounded-none select-none border-0
                                                        ${appliedEXGFiltersRef.current[index] === 1
                                                                ? "bg-green-700 hover:bg-white-500 text-white hover:text-white" // Disabled background
                                                                : "bg-white-500" // Active background
                                                            }`}
                                                    >
                                                        <Heart size={17} />
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleFrequencySelectionEXG(index, 2)}
                                                        className={`rounded-xl rounded-l-none border-0
                                                        ${appliedEXGFiltersRef.current[index] === 2
                                                                ? "bg-green-700 hover:bg-white-500 text-white hover:text-white" // Disabled background
                                                                : "bg-white-500" // Active background
                                                            }`}
                                                    >
                                                        <Eye size={17} />
                                                    </Button>
                                                </div>
                                                <div className="flex border border-input rounded-xl items-center mx-0 px-0">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => removeNotchFilter(index)}
                                                        className={`rounded-xl rounded-r-none border-0
                                                        ${appliedFiltersRef.current[index] === undefined
                                                                ? "bg-red-700 hover:bg-white-500 hover:text-white text-white" // Disabled background
                                                                : "bg-white-500" // Active background
                                                            }`}
                                                    >
                                                        <CircleOff size={17} />
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleFrequencySelection(index, 1)}
                                                        className={`flex items-center justify-center px-3 py-2 rounded-none select-none border-0
                                                        ${appliedFiltersRef.current[index] === 1
                                                                ? "bg-green-700 hover:bg-white-500 text-white hover:text-white" // Disabled background
                                                                : "bg-white-500" // Active background
                                                            }`}
                                                    >
                                                        50Hz
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleFrequencySelection(index, 2)}
                                                        className={
                                                            `rounded-xl rounded-l-none border-0 ${appliedFiltersRef.current[index] === 2
                                                                ? "bg-green-700 hover:bg-white-500 text-white hover:text-white "
                                                                : "bg-white-500 animate-fade-in-right"
                                                            }`
                                                        }
                                                    >
                                                        60Hz
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button className="flex items-center justify-center select-none whitespace-nowrap rounded-lg">
                                <Settings size={16} />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[30rem] p-4 rounded-md shadow-md text-sm">
                            <TooltipProvider>
                                <div className={`space-y-6 ${!isDisplay ? "flex justify-center" : ""}`}>
                                    {/* Channel Selection */}
                                    {(isDisplay && isRecord) && (
                                        <div className="flex items-center justify-center rounded-lg mb-[2.5rem]">
                                            <div className=" w-full">
                                                <div className="absolute inset-0 rounded-lg border-gray-300 dark:border-gray-600 opacity-50 pointer-events-none"></div>
                                                <div className="relative">
                                                    {/* Heading and Select All Button */}
                                                    <div className="flex items-center justify-between mb-4">
                                                        <h3 className="text-xs font-semibold text-gray-500">
                                                            <span className="font-bold text-gray-600">Channels Count:</span> {selectedChannels.length}
                                                        </h3>
                                                        {
                                                            !(selectedChannels.length === maxCanvasElementCountRef.current && manuallySelected) && (
                                                                <button
                                                                    onClick={handleSelectAllToggle}
                                                                    className={`px-4 py-1 text-xs font-light rounded-lg transition ${isSelectAllDisabled
                                                                        ? "text-gray-400 bg-gray-200 dark:bg-gray-700 dark:text-gray-500 cursor-not-allowed"
                                                                        : "text-white bg-black hover:bg-gray-700 dark:bg-white dark:text-black dark:border dark:border-gray-500 dark:hover:bg-primary/70"
                                                                        }`}
                                                                    disabled={isSelectAllDisabled}
                                                                >
                                                                    {isAllEnabledChannelSelected ? "RESET" : "Select All"}
                                                                </button>
                                                            )
                                                        }
                                                    </div>
                                                    {/* Button Grid */}
                                                    <div id="button-container" className="relative space-y-2 rounded-lg">
                                                        {Array.from({ length: 1 }).map((_, container) => (
                                                            <div key={container} className="grid grid-cols-8 gap-2">
                                                                {Array.from({ length: maxCanvasElementCountRef.current }).map((_, col) => {
                                                                    const index = container * 8 + col;
                                                                    const isChannelDisabled = index >= maxCanvasElementCountRef.current;
                                                                    const isSelected = selectedChannels.includes(index + 1);

                                                                    // For selected channels, use the shared custom color.
                                                                    // Otherwise, use default styles.
                                                                    const buttonStyle = isChannelDisabled
                                                                        ? isDarkModeEnabled
                                                                            ? { backgroundColor: "#030c21", color: "gray" }
                                                                            : { backgroundColor: "#e2e8f0", color: "gray" }
                                                                        : isSelected
                                                                            ? { backgroundColor: getCustomColor(index, activeTheme), color: "white" }
                                                                            : { backgroundColor: "white", color: "black" };

                                                                    // Optional: calculate rounded corners based on button position.
                                                                    const isFirstInRow = col === 0;
                                                                    const isLastInRow = col === 7;
                                                                    const isFirstContainer = container === 0;
                                                                    const isLastContainer = container === 1;
                                                                    const roundedClass = `
                                   ${isFirstInRow && isFirstContainer ? "rounded-tl-lg" : ""}
                                   ${isLastInRow && isFirstContainer ? "rounded-tr-lg" : ""}
                                   ${isFirstInRow && isLastContainer ? "rounded-bl-lg" : ""}
                                   ${isLastInRow && isLastContainer ? "rounded-br-lg" : ""}
                                 `;

                                                                    return (
                                                                        <button
                                                                            key={index}
                                                                            onClick={() => !isChannelDisabled && toggleChannel(index + 1)}
                                                                            disabled={isChannelDisabled}
                                                                            style={buttonStyle}
                                                                            className={`w-full h-8 text-xs font-medium py-1 border border-gray-300 dark:border-gray-600 transition-colors duration-200 ${roundedClass}`}
                                                                        >
                                                                            {`CH${index + 1}`}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {/* Zoom Controls */}
                                    <div className={`relative w-full flex flex-col ${!isDisplay ? "" : "items-start"} text-sm`}>
                                        <p className="absolute top-[-1.2rem] left-0 text-xs font-semibold text-gray-500">
                                            <span className="font-bold text-gray-600">Zoom Level:</span> {Zoom}x
                                        </p>
                                        <div className="relative w-[28rem] flex items-center rounded-lg py-2 border border-gray-300 dark:border-gray-600 mb-4">
                                            {/* Button for setting Zoom to 1 */}
                                            <button
                                                className="text-gray-700 dark:text-gray-400 mx-1 px-2 py-1 border rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                                                onClick={() => SetZoom(1)}
                                            >
                                                1
                                            </button>

                                            <input
                                                type="range"
                                                min="1"
                                                max="10"
                                                value={Zoom}
                                                onChange={(e) => SetZoom(Number(e.target.value))}
                                                style={{
                                                    background: `linear-gradient(to right, rgb(101, 136, 205) ${((Zoom - 1) / 9) * 100}%, rgb(165, 165, 165) ${((Zoom - 1) / 9) * 11}%)`,
                                                }}
                                                className="flex-1 h-[0.15rem] rounded-full appearance-none bg-gray-800 focus:outline-none focus:ring-0 slider-input"
                                            />

                                            {/* Button for setting Zoom to 10 */}
                                            <button
                                                className="text-gray-700 dark:text-gray-400 mx-2 px-2 py-1 border rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                                                onClick={() => SetZoom(10)}
                                            >
                                                10
                                            </button>
                                            <style jsx>{` input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 15px; height: 15px;
                                                                 background-color: rgb(101, 136, 205); border-radius: 50%; cursor: pointer; } `}</style>
                                        </div>
                                    </div>

                                    {/* Time-Base Selection */}
                                    {isDisplay && (
                                        <div className="relative w-full flex flex-col items-start mt-3 text-sm">
                                            <p className="absolute top-[-1.2rem] left-0 text-xs font-semibold text-gray-500">
                                                <span className="font-bold text-gray-600">Time Base:</span> {timeBase} Seconds
                                            </p>
                                            <div className="relative w-[28rem] flex items-center rounded-lg py-2 border border-gray-300 dark:border-gray-600">
                                                {/* Button for setting Time Base to 1 */}
                                                <button
                                                    className="text-gray-700 dark:text-gray-400 mx-1 px-2 py-1 border rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                                                    onClick={() => setTimeBase(1)}
                                                >
                                                    1
                                                </button>
                                                <input
                                                    type="range"
                                                    min="1"
                                                    max="10"
                                                    value={timeBase}
                                                    onChange={(e) => setTimeBase(Number(e.target.value))}
                                                    style={{
                                                        background: `linear-gradient(to right, rgb(101, 136, 205) ${((timeBase - 1) / 9) * 100}%, rgb(165, 165, 165) ${((timeBase - 1) / 9) * 11}%)`,
                                                    }}
                                                    className="flex-1 h-[0.15rem] rounded-full appearance-none bg-gray-200 focus:outline-none focus:ring-0 slider-input"
                                                />
                                                {/* Button for setting Time Base to 10 */}
                                                <button
                                                    className="text-gray-700 dark:text-gray-400 mx-2 px-2 py-1 border rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                                                    onClick={() => setTimeBase(10)}
                                                >
                                                    10
                                                </button>
                                                <style jsx>{` input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none;appearance: none; width: 15px; height: 15px;
                                                                  background-color: rgb(101, 136, 205); border-radius: 50%; cursor: pointer; }`}</style>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </TooltipProvider>
                        </PopoverContent>
                    </Popover>
                </div>
            </div>
        </div>
    );

}

export default NPG_Ble;
