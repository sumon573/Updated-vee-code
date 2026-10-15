package com.vee.app.voice;

import android.content.Intent;
import android.os.Build;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/**
 * 2026-10-15 (Sumon): JS bridge to start/stop the voice foreground service.
 */
public class VoiceServiceModule extends ReactContextBaseJavaModule {
  public VoiceServiceModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "VoiceForegroundService";
  }

  @ReactMethod
  public void start(String title) {
    try {
      ReactApplicationContext ctx = getReactApplicationContext();
      Intent i = new Intent(ctx, VoiceForegroundService.class);
      i.putExtra(VoiceForegroundService.EXTRA_TITLE, title);
      if (Build.VERSION.SDK_INT >= 26) {
        ctx.startForegroundService(i);
      } else {
        ctx.startService(i);
      }
    } catch (Exception ignored) {
    }
  }

  @ReactMethod
  public void stop() {
    try {
      ReactApplicationContext ctx = getReactApplicationContext();
      ctx.stopService(new Intent(ctx, VoiceForegroundService.class));
    } catch (Exception ignored) {
    }
  }
}
