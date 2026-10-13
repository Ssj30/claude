import "react";

// App Bridge declares its elements on the global JSX namespace, which React 19
// no longer reads, so declare the one we use here.
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": { children?: React.ReactNode };
    }
  }
}
