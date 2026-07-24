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
    SearchAndReplace: (props: {
      searchString: string;
      replaceString: string;
      matchCase?: boolean;
    }) => number;
    GetRangeBySelect: () => { Delete: () => void } | null;
    AddComment?: (text: string, author: string, userId: string) => void;
  }

  interface AscContentElement {
    GetRange?: () => { AddComment: (text: string, author: string, userId: string) => void };
  }

  interface AscSheet {
    GetUsedRange: () => { GetValue: () => unknown[][] };
    GetRange: (addr: string) => {
      SetValue: (v: string | number) => void;
      AutoFit: (w: boolean, h: boolean) => void;
    };
    GetSelection: () => {
      Clear: () => void;
      SetValue: (v: string) => void;
    };
  }

  const Api: {
    GetDocument: () => AscDocument;
    GetActiveSheet: () => AscSheet;
  };

  const Asc: {
    scope?: Record<string, unknown>;
  };
}
