import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';
import type { View } from 'react-native';

// 2026-11-01 (keyboard dock fix): on the current Android build the
// window is adjustResize (app.json) but the layout does NOT shrink when
// the keyboard opens (edge-to-edge), so the chat composer sat behind the
// keyboard while the header stayed put (no pan anymore). KAV stays OFF
// on Android (it would double-shift on the old adjustPan binary), so
// docking is measured instead of assumed:
//   - on keyboardDidShow, measure the composer wrapper's on-screen
//     bottom against the FULL window height minus the keyboard height;
//   - covered (overlay binary) -> pad the column by exactly the amount
//     that docks the composer above the keys (thread: kbH; room: kbH
//     minus its fixed bottom-bar reserve, which cancels in the math);
//   - already visible (pan binary: OS panned it into view, or a
//     resize binary whose layout shrank) -> pad 0, byte-identical.
// 2026-11-01 (dock fix v2 — the first version collapsed): the v1 check
// compared the MEASURED bottom (which already includes the current pad)
// against the keyboard top, so the 350ms re-measure always concluded
// 'not covered' and reset the pad to 0 — the room composer fell back
// behind the keyboard, and the inbox emoji view (taller than the text
// keyboard) hid the text box. v2 measures the NATURAL bottom (measured
// bottom + current pad = where the composer would sit with no variable
// pad), so the pad is stable across re-measures and grows when the
// keyboard grows (text -> emoji view). A mid-session measure never
// collapses the pad to 0 (transient mid-animation frames); only
// keyboardDidHide resets. A new show event cancels the pending
// re-measure timer, so a stale height can never overwrite a fresh one.
// Android only; other platforms return 0 and never subscribe.
type Measurable = {
  measure?: (
    cb: (x: number, y: number, w: number, h: number, px: number, py: number) => void,
  ) => void;
};

export function useKeyboardDockPadding() {
  const [dockPad, setDockPad] = useState(0);
  const dockPadRef = useRef(0);
  const composerRef = useRef<View | null>(null);
  const fullHeightRef = useRef(Dimensions.get('window').height);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = (kbH: number) => {
      if (kbH <= 0) return;
      const node = composerRef.current as unknown as Measurable | null;
      if (!node || typeof node.measure !== 'function') return;
      const fullH = Math.max(fullHeightRef.current, Dimensions.get('window').height);
      fullHeightRef.current = fullH;
      node.measure((_x, _y, _w, h, _px, pageY) => {
        // Natural bottom = where the composer would sit with NO variable
        // pad. The room's fixed bottom-bar reserve is inside both the
        // measured bottom and the layout, so it cancels here — the pad
        // this computes docks the composer exactly above the keys on
        // both screens.
        const naturalBottom = pageY + h + dockPadRef.current;
        const need = naturalBottom - (fullH - kbH);
        if (need > 1) {
          dockPadRef.current = need;
          setDockPad(need);
        }
        // need <= 1 with a pad already set = transient mid-animation
        // frame: never collapse mid-session; hide resets to 0.
      });
    };
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      const kbH = e.endCoordinates ? e.endCoordinates.height : 0;
      if (timer) clearTimeout(timer);
      check(kbH);
      timer = setTimeout(() => check(kbH), 350);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      if (timer) clearTimeout(timer);
      fullHeightRef.current = Math.max(
        fullHeightRef.current,
        Dimensions.get('window').height,
      );
      dockPadRef.current = 0;
      setDockPad(0);
    });
    return () => {
      show.remove();
      hide.remove();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { dockPad, composerRef };
}
