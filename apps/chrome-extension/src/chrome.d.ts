declare const chrome: {
  devtools: {
    network: {
      onRequestFinished: {
        addListener(callback: (request: unknown) => void): void;
      };
    };
    panels: {
      create(
        title: string,
        iconPath: string,
        pagePath: string,
        callback?: () => void,
      ): void;
    };
  };
};
