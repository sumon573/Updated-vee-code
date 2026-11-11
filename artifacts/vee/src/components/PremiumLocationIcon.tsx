import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';

// Real location marker (boss, 2026-10-30): the batch-6 gradient blob did NOT
// read as a location icon - replaced with a true map-pin silhouette drawn
// with react-native-svg (already a dependency, no new native module): ONE
// continuous teardrop (round head tapering to a point) with a white center
// hole, violet-to-fuchsia gradient fill for the premium finish. Shape clarity
// first: at a glance it is unmistakably a location pin. Same 13x15 slot +
// marginRight 4 as before, so the country chip layout, text, and alignment
// are unchanged.
// Shared (2026-11-11, popup taller-2): moved here verbatim from
// app/profile/index.tsx so the profile screen AND the profile popup render
// the identical pin - no drift between the two surfaces.
export function PremiumLocationIcon() {
  return (
    <View style={{ width: 13, height: 15, marginRight: 4, alignItems: 'center' }}>
      <Svg width={13} height={15} viewBox="0 0 14 16">
        <Defs>
          <SvgLinearGradient id="veePinGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#C4B5FD" />
            <Stop offset="0.5" stopColor="#8B5CF6" />
            <Stop offset="1" stopColor="#D946EF" />
          </SvgLinearGradient>
        </Defs>
        <Path
          d="M7,0 C3.4,0 0.5,2.9 0.5,6.5 C0.5,10.8 7,16 7,16 C7,16 13.5,10.8 13.5,6.5 C13.5,2.9 10.6,0 7,0 Z"
          fill="url(#veePinGrad)"
        />
        <Circle cx={7} cy={6.5} r={2.6} fill="#FFFFFF" />
      </Svg>
    </View>
  );
}
