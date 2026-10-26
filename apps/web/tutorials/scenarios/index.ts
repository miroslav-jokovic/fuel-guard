import type { Tutorial } from "../scenario";
import { dispatchBoard } from "./dispatch-board";
import { liveMap } from "./live-map";
import { loads } from "./loads";
import { placardCalculator } from "./placard-calculator";

/** Every tutorial, in the order a new dispatcher meets them. A new one is added here. */
export const TUTORIALS: Tutorial[] = [dispatchBoard, loads, liveMap, placardCalculator];
