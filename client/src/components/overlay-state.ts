import { createContext } from "react";

export const PortalPositionedContext = createContext(true);

export type OverlayCloseReason = "keyboard" | "pointer" | "action";
