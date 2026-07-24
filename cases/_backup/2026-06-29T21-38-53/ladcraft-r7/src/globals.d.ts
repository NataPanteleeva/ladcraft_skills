export {};

declare global {
  interface Window {
    Asc: {
      plugin: AscPlugin;
    };
  }

  interface AscPlugin {
    guid?: string;
    init: () => void;
    button: (id: number) => void;
    onDestroy?: () => void;
    onExternalMouseUp?: () => void;
    event_onContextMenuShow?: (options: { guid: string }) => void;
    event_onContextMenuClick?: (id: string) => void;
    info?: AscPluginInfo;
    callCommand: (
      fn: () => unknown,
      isClose?: boolean,
      isCalc?: boolean,
      callback?: (result: string) => void,
      errorCallback?: (err: unknown) => void,
    ) => void;
    executeMethod: (
      name: string,
      args: unknown[],
      callback: (result: unknown) => void,
    ) => void;
  }

  interface AscDocument {
    GetContent: () => AscContentElement[];
    ToMarkdown: () => string;
  }

  interface AscSheet {
    GetUsedRange: () => { GetValue: () => unknown[][] };
    GetRange: (addr: string) => {
      SetValue: (v: string) => void;
      AutoFit: (w: boolean, h: boolean) => void;
    };
  }
}
