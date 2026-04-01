/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';

import { bridge } from '@office-ai/platform';
import { ADAPTER_BRIDGE_EVENT_KEY } from './constant';
import { registerWebSocketBroadcaster, getBridgeEmitter, setBridgeEmitter, broadcastToAll } from './registry';

/**
 * Bridge event data structure for IPC communication
 * IPC 通信的桥接事件数据结构
 */
interface BridgeEventData {
  name: string;
  data: unknown;
}

const adapterWindowList: Array<BrowserWindow> = [];

export { registerWebSocketBroadcaster, getBridgeEmitter };

/**
 * @description 建立与每一个browserWindow的通信桥梁
 * */
bridge.adapter({
  emit(name, data) {
    // 1. Send to all Electron BrowserWindows (skip destroyed ones)
    for (let i = adapterWindowList.length - 1; i >= 0; i--) {
      const win = adapterWindowList[i];
      if (win.isDestroyed() || win.webContents.isDestroyed()) {
        adapterWindowList.splice(i, 1);
        continue;
      }
      win.webContents.send(ADAPTER_BRIDGE_EVENT_KEY, JSON.stringify({ name, data }));
    }
    // 2. Also broadcast to all WebSocket clients
    broadcastToAll(name, data);
  },
  on(emitter) {
    // 保存 emitter 引用供 WebSocket 处理使用 / Save emitter reference for WebSocket handling
    setBridgeEmitter(emitter);

    // test-workbench_change: Check if handler already exists (VS Code integration mode)
    // In VS Code integration, the handler might already be registered by a previous window
    try {
      ipcMain.handle(ADAPTER_BRIDGE_EVENT_KEY, async (_event, info) => {
        const { name, data } = JSON.parse(info) as BridgeEventData;

        // test-workbench_change: Implement proper bridge callback pattern
        // The @office-ai/platform bridge uses a callback pattern:
        // 1. Consumer sends "subscribe-{name}" with {id, data}
        // 2. Provider processes and sends "subscribe.callback-{name}{id}" with result
        // 3. Consumer listens for callback and resolves promise

        // Extract the ID from the data (if it exists)
        const requestId = (data as any)?.id;

        if (!requestId) {
          // No ID means this is not a subscribe request, just emit and return
          emitter.emit(name, data);
          return undefined;
        }

        // Set up a promise that waits for the callback event
        return new Promise((resolve, reject) => {
          const callbackEventName = `subscribe.callback-${name.replace('subscribe-', '')}${requestId}`;
          const timeout = setTimeout(() => {
            emitter.off(callbackEventName, callbackHandler);
            reject(new Error(`Bridge callback timeout for ${name} (id: ${requestId})`));
          }, 10000);

          const callbackHandler = (responseData: unknown) => {
            clearTimeout(timeout);
            resolve(responseData);
          };

          // Listen for the callback event
          emitter.once(callbackEventName, callbackHandler);

          // Emit the request event to trigger providers
          emitter.emit(name, data);
        });
      });
      console.log('[AionUI] IPC handler registered successfully');
    } catch (error) {
      // Handler already exists, which is fine in VS Code integration mode
      if (error instanceof Error && error.message.includes('second handler')) {
        console.log('[AionUI] IPC handler already registered, reusing existing handler');
      } else {
        // Re-throw if it's a different error
        throw error;
      }
    }
    // test-workbench_change end
  },
});

export const initMainAdapterWithWindow = (win: BrowserWindow) => {
  adapterWindowList.push(win);
  const off = () => {
    const index = adapterWindowList.indexOf(win);
    if (index > -1) adapterWindowList.splice(index, 1);
  };
  win.on('closed', off);
  return off;
};
