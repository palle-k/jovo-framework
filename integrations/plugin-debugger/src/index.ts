import { HandleRequest } from '@jovotech/core';
import { JovoDebugger, JovoDebuggerConfig } from './JovoDebugger';

declare module '@jovotech/core/dist/Extensible' {
  interface ExtensiblePluginConfig {
    JovoDebugger?: JovoDebuggerConfig;
  }

  interface ExtensiblePlugins {
    JovoDebugger?: JovoDebugger;
  }
}

declare module '@jovotech/core/dist/HandleRequest' {
  interface HandleRequest {
    debuggerRequestId: number;
  }
}

HandleRequest.prototype.debuggerRequestId = 0;

export * from './JovoDebugger';