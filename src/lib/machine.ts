import { useCallback, useState } from "react";

/**
 * Lightweight state machine hook.
 * Matches the explicit Phase / Step unions already used in AppUpdateContext,
 * useExtendHistory, Onboarding, and ManualAccountDialog.
 *
 * Transitions are a map from current state → event → next state.
 * Unknown events leave the state unchanged.
 */
export function useMachine<S extends string, E extends string>(
  initial: S,
  transitions: Record<S, Partial<Record<E, S>>>,
) {
  const [state, setState] = useState<S>(initial);

  const send = useCallback(
    (event: E) => {
      setState((current) => {
        const next = transitions[current]?.[event];
        return next ?? current;
      });
    },
    [transitions],
  );

  return [state, send] as const;
}
