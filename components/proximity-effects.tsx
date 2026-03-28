"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type MotionState = {
  tx: number;
  ty: number;
  glow: number;
  shadow: number;
  trailX: number;
  trailY: number;
  trailGlow: number;
  targetTx: number;
  targetTy: number;
  targetGlow: number;
  targetShadow: number;
  targetTrailX: number;
  targetTrailY: number;
  targetTrailGlow: number;
  active: boolean;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export default function ProximityEffects() {
  const pathname = usePathname();

  useEffect(() => {
    const supportsInteractiveHover = window.matchMedia(
      "(hover: hover) and (pointer: fine)",
    ).matches;
    const hasCoarsePointer =
      window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(any-pointer: coarse)").matches;
    const allowsMotion = window.matchMedia(
      "(prefers-reduced-motion: no-preference)",
    ).matches;
    if (!allowsMotion) return;

    const usePointerAttraction = supportsInteractiveHover && !hasCoarsePointer;

    let mx = -9999;
    let my = -9999;
    let scrollVelocity = 0;
    let lastScrollY = window.scrollY;
    let lastScrollTs = performance.now();
    let raf = 0;
    let lastFrameTs = performance.now();
    let lowFpsFrameCount = 0;
    let effectsDisabledForPerf = false;
    const states = new Map<HTMLElement, MotionState>();

    const getTargets = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-proximity]"));

    const getState = (el: HTMLElement) => {
      let state = states.get(el);
      if (!state) {
        state = {
          tx: 0,
          ty: 0,
          glow: 0,
          shadow: 0,
          trailX: 50,
          trailY: 50,
          trailGlow: 0,
          targetTx: 0,
          targetTy: 0,
          targetGlow: 0,
          targetShadow: 0,
          targetTrailX: 50,
          targetTrailY: 50,
          targetTrailGlow: 0,
          active: false,
        };
        states.set(el, state);
      }
      return state;
    };

    const hardResetTarget = (el: HTMLElement) => {
      el.style.setProperty("--tx", "0px");
      el.style.setProperty("--ty", "0px");
      el.style.setProperty("--glow-opacity", "0");
      el.style.setProperty("--shadow-alpha", "0");
      el.style.setProperty("--trail-opacity", "0");
      el.classList.remove("proximity-active");
    };

    const update = () => {
      raf = 0;
      const nowTs = performance.now();
      const frameMs = nowTs - lastFrameTs;
      lastFrameTs = nowTs;

      if (frameMs > 1000 / 40) {
        lowFpsFrameCount += 1;
      } else {
        lowFpsFrameCount = Math.max(0, lowFpsFrameCount - 1);
      }

      if (lowFpsFrameCount > 24 && !effectsDisabledForPerf) {
        effectsDisabledForPerf = true;
        getTargets().forEach(hardResetTarget);
        return;
      }

      if (effectsDisabledForPerf) return;

      const lerpFactor = clamp(frameMs / 16, 0.5, 4);
      const targets = getTargets();

      for (const el of targets) {
        const rect = el.getBoundingClientRect();
        const strength = parseFloat(el.dataset.proximityStrength ?? "1.2");
        const noGlow = el.dataset.proximityNoGlow === "true";

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = mx - cx;
        const dy = my - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const activationRadius = Math.max(rect.width, rect.height) * 2.4;
        const isNear = dist < activationRadius;

        const state = getState(el);

        if (usePointerAttraction && isNear) {
          const norm = activationRadius;
          const pull = Math.max(0, 1 - dist / norm);
          const maxShift = strength * 5;
          state.targetTx = clamp((dx / norm) * maxShift * pull, -maxShift, maxShift);
          state.targetTy = clamp((dy / norm) * maxShift * pull, -maxShift, maxShift);
          state.targetGlow = noGlow ? 0 : pull * 0.9;
          state.targetShadow = pull * 0.35;

          const mxPct = clamp(((mx - rect.left) / rect.width) * 100, 0, 100);
          const myPct = clamp(((my - rect.top) / rect.height) * 100, 0, 100);
          state.targetTrailX = mxPct;
          state.targetTrailY = myPct;
          state.targetTrailGlow = noGlow ? 0 : pull * 0.7;
        } else {
          state.targetTx = 0;
          state.targetTy = 0;
          state.targetGlow = 0;
          state.targetShadow = 0;
          state.targetTrailGlow = 0;
        }

        const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t * 0.14 * lerpFactor, 0, 1);

        state.tx = lerp(state.tx, state.targetTx, 1);
        state.ty = lerp(state.ty, state.targetTy, 1);
        state.glow = lerp(state.glow, state.targetGlow, 1);
        state.shadow = lerp(state.shadow, state.targetShadow, 1);
        state.trailX = lerp(state.trailX, state.targetTrailX, 1);
        state.trailY = lerp(state.trailY, state.targetTrailY, 1);
        state.trailGlow = lerp(state.trailGlow, state.targetTrailGlow, 1);

        const wasActive = state.active;
        state.active = isNear && usePointerAttraction;

        if (state.active !== wasActive) {
          if (state.active) {
            el.classList.add("proximity-active");
          } else {
            el.classList.remove("proximity-active");
          }
        }

        el.style.setProperty("--tx", `${state.tx.toFixed(2)}px`);
        el.style.setProperty("--ty", `${state.ty.toFixed(2)}px`);
        el.style.setProperty("--glow-opacity", state.glow.toFixed(3));
        el.style.setProperty("--shadow-alpha", state.shadow.toFixed(3));
        el.style.setProperty("--mx", `${state.trailX.toFixed(1)}%`);
        el.style.setProperty("--my", `${state.trailY.toFixed(1)}%`);
        el.style.setProperty("--mx-trail", `${state.trailX.toFixed(1)}%`);
        el.style.setProperty("--my-trail", `${state.trailY.toFixed(1)}%`);
        el.style.setProperty("--trail-opacity", state.trailGlow.toFixed(3));
      }

      if (targets.length > 0) {
        raf = window.requestAnimationFrame(update);
      }
    };

    const scheduleUpdate = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };

    const onMouseMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
      scheduleUpdate();
    };

    const onScroll = () => {
      const now = performance.now();
      const dt = now - lastScrollTs;
      const dy = window.scrollY - lastScrollY;
      scrollVelocity = dt > 0 ? Math.abs(dy / dt) : 0;
      lastScrollY = window.scrollY;
      lastScrollTs = now;
      scheduleUpdate();
    };

    const onMouseLeave = () => {
      mx = -9999;
      my = -9999;
      scheduleUpdate();
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.documentElement.addEventListener("mouseleave", onMouseLeave);

    scheduleUpdate();

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("scroll", onScroll);
      document.documentElement.removeEventListener("mouseleave", onMouseLeave);
      if (raf) window.cancelAnimationFrame(raf);
      getTargets().forEach(hardResetTarget);
      states.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
