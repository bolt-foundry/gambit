export type Props = {
    /**
    Exit (unmount) the whole Ink app.
    */
    readonly exit: (error?: Error) => void;
};
/**
`AppContext` is a React context that exposes a method to manually exit the app (unmount).
*/
declare const AppContext: import("react").Context<Props>;
export default AppContext;
