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
//     bottom (pageY + height) against the FULL window height minus the
//     keyboard height;
//   - covered (overlay binary) -> pad the column by the keyboard height,
//     which shrinks the flex list and docks the composer above the keys;
//   - already visible (pan binary: OS panned it into view, or a
//     resize binary whose layout shrank) -> pad 0, byte-identical.
// A second measure 350ms later corrects a mid-pan false positive: the
// settled measure is authoritative. On keyboardDidHide the pad resets.
// Android only; other platforms return 0 and never subscribe.
type Measurable = {
  measure?: (
    cb: (x: number, y: number, w: number, h: number, px: number, py: number) => void,
  ) => void;
};

export function useKeyboardDockPadding() {
  const [dockPad, setDockPad] = useState(0);
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
        const covered = pageY + h > fullH - kbH + 1;
        setDockPad(covered ? kbH : 0);
      });
    };
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      const kbH = e.endCoordinates ? e.endCoordinates.height : 0;
      check(kbH);
      timer = setTimeout(() => check(kbH), 350);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      if (timer) clearTimeout(timer);
      fullHeightRef.current = Math.max(
        fullHeightRef.current,
        Dimensions.get('window').height,
      );
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
