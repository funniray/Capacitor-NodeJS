import type { ChildProcess, ForkOptions } from 'child_process';
import { fork } from 'child_process';
import { app } from 'electron';
import { join as joinPath } from 'path';

import type { ChannelPayloadData } from '../../src/definitions';

import type { CapacitorNodeJS } from "./index";
import { joinEnv } from './utils';

type EngineStatusReadyCallback = () => void;

class EngineStatus {
    private whenEngineReadyListeners: EngineStatusReadyCallback[] = [];
    private isEngineStarted = false;
    private isEngineReady = false;

    public setStarted(): void {
        this.isEngineStarted = true;
    }

    public isStarted(): boolean {
        return this.isEngineStarted;
    }

    public setReady(): void {
        this.isEngineReady = true;

        while (this.whenEngineReadyListeners.length > 0) {
            const whenEngineReadyListener = this.whenEngineReadyListeners[0];
            whenEngineReadyListener();
            this.whenEngineReadyListeners.splice(0, 1);
        }
    }

    public isReady(): boolean {
        return this.isEngineReady;
    }

    public whenReady(callback: EngineStatusReadyCallback): void {
        if (this.isReady()) {
            callback();
        } else {
            this.whenEngineReadyListeners.push(callback);
        }
    }
}

export class CapacitorNodeJSImplementation {
    private nodeProcess?: ChildProcess;
    private eventNotifier: CapacitorNodeJS['PluginEventNotifier'];
    private engineStatus = new EngineStatus();

    constructor(eventNotifier: CapacitorNodeJS['PluginEventNotifier']) {
        this.eventNotifier = eventNotifier;
    }

    public async startEngine(projectDir: string): Promise<void> {
        if (this.engineStatus.isStarted()) {
            throw new Error('The Node.js engine has already been started.');
        }
        this.engineStatus.setStarted();

        const projectPath = joinPath(app.getAppPath(), 'app', projectDir);

        const projectPackageJsonPath = joinPath(projectPath, "package.json");
        const projectPackageJson = await import(projectPackageJsonPath);

        const projectMainFile = projectPackageJson.main;
        const projectMainPath = joinPath(projectPath, projectMainFile);

        const modulesPaths = joinEnv(projectPath /*, bridgeModulePath, ... */);

        const nodeParameters: string[] = [];
        const nodeOptions: ForkOptions = {
            env: { NODE_PATH: modulesPaths },
            serialization: 'json'
        };

        this.nodeProcess = fork(projectMainPath, nodeParameters, nodeOptions);

        this.nodeProcess.on('message', (args: any) => {
            this.receiveMessage(args.channelName, args.payload);
        });
    }

    public resolveWhenReady(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!this.engineStatus.isStarted()) {
                reject('The Node.js engine has not been started.');
            }

            this.engineStatus.whenReady(() => resolve());
        });
    }

    public sendMessage(args: ChannelPayloadData): void {
        if (!this.engineStatus.isStarted()) {
            throw new Error('The Node.js engine has not been started.');
        }

        if (!this.engineStatus.isReady()) {
            throw new Error('The Node.js engine is not ready yet.');
        }

        const eventName = args.eventName;
        const data = args.args;
        
        if (this.nodeProcess === undefined || !eventName || !data) return;

        // TODO: refactor payload
        const payload = { event: eventName, payload: JSON.stringify(data) };
        this.nodeProcess.send({ channelName: "EVENT_CHANNEL", payload: JSON.stringify(payload) });
    }

    private receiveMessage(channelName: string, payload: string) {
        // TODO: refactor payload
        const data = JSON.parse(payload);

        const eventName = data.event;
        const args = data.payload;

        if (channelName === "APP_CHANNEL" && eventName === "ready") {
            this.engineStatus.setReady();
        } else if (channelName === "EVENT_CHANNEL") {
            this.eventNotifier.channelReceive(eventName, args);
        }
    }
}