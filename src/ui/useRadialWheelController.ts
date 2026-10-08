import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { AppState, ExcalidrawImperativeAPI, ToolType } from "@excalidraw/excalidraw/types";
import type { ColorTarget } from "./RadialToolWheel";
import {
  FALLBACK_COLOR_PICKS,
  resolveRadialSlots,
  type RadialWheelPreferences,
} from "./radialWheelDefaults";
import { clampWheelPosition } from "./radialWheelGeometry";

export type RadialWheelControllerState = {
  open: boolean;
  x: number;
  y: number;
  colorTarget: ColorTarget;
  strokeColor: string;
  fillColor: string;
  colorPicks: string[];
  slots: ReturnType<typeof resolveRadialSlots>;
  activeTool: ToolType | null;
  lastPenButton: number | null;
  selectTool: (type: ToolType) => void;
  selectColor: (color: string, autoDismiss?: boolean) => void;
  setColorTarget: (target: ColorTarget) => void;
  dismiss: () => void;
};

type UseRadialWheelControllerArgs = {
  enabled: boolean;
  preferences: RadialWheelPreferences;
  canvasRef: RefObject<HTMLElement | null>;
  apiRef: RefObject<ExcalidrawImperativeAPI | null>;
  appStateRef: MutableRefObject<Partial<AppState>>;
};

function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

function resolveColorPicks(appState: Partial<AppState>, colorTarget: ColorTarget): string[] {
  const picks =
    colorTarget === "stroke"
      ? appState.colorTopPicks?.elementStroke
      : appState.colorTopPicks?.elementBackground;
  if (picks && picks.length) return [...picks].slice(0, 7);
  return [...FALLBACK_COLOR_PICKS];
}

function isAuxOpenButton(event: PointerEvent, pointerButton: number): boolean {
  if (event.button === 0) return false;
  if (event.button !== pointerButton) return false;
  return event.pointerType === "pen" || event.pointerType === "mouse";
}

/**
 * Tap-to-open radial menu:
 * - Shortcut / pen aux toggles the wheel open and it STAYS open
 * - Choosing a tool/color is done by clicking the wheel UI (not by releasing a hold)
 */
export function useRadialWheelController({
  enabled,
  preferences,
  canvasRef,
  apiRef,
  appStateRef,
}: UseRadialWheelControllerArgs): RadialWheelControllerState {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [colorTarget, setColorTargetState] = useState<ColorTarget>("stroke");
  const [lastPenButton, setLastPenButton] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType | null>(null);
  const [colorSnapshot, setColorSnapshot] = useState({
    strokeColor: "#1e1e1e",
    fillColor: "transparent",
    colorPicks: [...FALLBACK_COLOR_PICKS] as string[],
  });

  const openRef = useRef(false);
  const lastPointerRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const preferencesRef = useRef(preferences);
  const colorTargetRef = useRef(colorTarget);
  const slots = useMemo(() => resolveRadialSlots(preferences.slots), [preferences.slots]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);
  useEffect(() => {
    colorTargetRef.current = colorTarget;
  }, [colorTarget]);

  const syncColorsFromAppState = useCallback(() => {
    const api = apiRef.current;
    const state = api?.getAppState() ?? appStateRef.current;
    const strokeColor = state.currentItemStrokeColor ?? "#1e1e1e";
    const fillColor = state.currentItemBackgroundColor ?? "transparent";
    const colorPicks = resolveColorPicks(state, colorTargetRef.current);
    setColorSnapshot({ strokeColor, fillColor, colorPicks });
  }, [apiRef, appStateRef]);

  const dismiss = useCallback(() => {
    setOpen(false);
    openRef.current = false;
  }, []);

  const openWheelAt = useCallback(
    (clientX: number, clientY: number) => {
      const clamped = clampWheelPosition(clientX, clientY);
      const state = apiRef.current?.getAppState() ?? appStateRef.current;
      setActiveTool((state.activeTool?.type as ToolType | undefined) ?? null);
      syncColorsFromAppState();
      setOrigin(clamped);
      setOpen(true);
      openRef.current = true;
    },
    [apiRef, appStateRef, syncColorsFromAppState],
  );

  const toggleWheel = useCallback(() => {
    if (openRef.current) {
      dismiss();
      return;
    }
    const { x, y } = lastPointerRef.current;
    openWheelAt(x, y);
  }, [dismiss, openWheelAt]);

  const selectTool = useCallback(
    (type: ToolType) => {
      apiRef.current?.setActiveTool({ type });
      setActiveTool(type);
      dismiss();
    },
    [apiRef, dismiss],
  );

  const selectColor = useCallback(
    (color: string, autoDismiss = false) => {
      const api = apiRef.current;
      if (!api) return;
      if (colorTargetRef.current === "stroke") {
        api.updateScene({ appState: { currentItemStrokeColor: color } });
        appStateRef.current = { ...appStateRef.current, currentItemStrokeColor: color };
        setColorSnapshot((prev) => ({ ...prev, strokeColor: color }));
      } else {
        api.updateScene({ appState: { currentItemBackgroundColor: color } });
        appStateRef.current = { ...appStateRef.current, currentItemBackgroundColor: color };
        setColorSnapshot((prev) => ({ ...prev, fillColor: color }));
      }
      if (autoDismiss) {
        dismiss();
      }
    },
    [apiRef, appStateRef, dismiss],
  );

  const setColorTarget = useCallback(
    (target: ColorTarget) => {
      colorTargetRef.current = target;
      setColorTargetState(target);
      setColorSnapshot((prev) => ({
        ...prev,
        colorPicks: resolveColorPicks(appStateRef.current, target),
      }));
    },
    [appStateRef],
  );

  // Track cursor so the wheel can open where you're pointing.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Pen / mouse aux button: tap toggles open/closed.
  useEffect(() => {
    if (!enabled || !preferences.enabled) return;

    const onPointerDown = (event: PointerEvent) => {
      if (isTextEntryTarget(event.target)) return;
      if (event.pointerType === "pen") setLastPenButton(event.button);
      if (!isAuxOpenButton(event, preferencesRef.current.pointerButton)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (isTextEntryTarget(event.target)) return;
      if (event.pointerType === "pen") setLastPenButton(event.button);
      if (!isAuxOpenButton(event, preferencesRef.current.pointerButton)) return;
      event.preventDefault();
      event.stopPropagation();
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      toggleWheel();
    };

    const onContextMenu = (event: MouseEvent) => {
      if (preferencesRef.current.pointerButton === 2) {
        if (isTextEntryTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [enabled, preferences.enabled, toggleWheel]);

  // Keyboard: keydown toggles. keyup does nothing (so holding never closes it).
  useEffect(() => {
    if (!enabled || !preferences.enabled || !preferences.keyboardHoldKey) return;

    const toggleKey = preferences.keyboardHoldKey;
    const matches = (event: KeyboardEvent) => {
      if (toggleKey === "Tab") return event.key === "Tab";
      if (toggleKey === "`") return event.key === "`" || event.code === "Backquote";
      return event.key === toggleKey;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (isTextEntryTarget(event.target)) return;

      if (openRef.current && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!matches(event)) return;

      event.preventDefault();
      event.stopPropagation();
      toggleWheel();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [dismiss, enabled, preferences.enabled, preferences.keyboardHoldKey, toggleWheel]);

  return {
    open,
    x: origin.x,
    y: origin.y,
    colorTarget,
    strokeColor: colorSnapshot.strokeColor,
    fillColor: colorSnapshot.fillColor,
    colorPicks: colorSnapshot.colorPicks,
    slots,
    activeTool,
    lastPenButton,
    selectTool,
    selectColor,
    setColorTarget,
    dismiss,
  };
}
