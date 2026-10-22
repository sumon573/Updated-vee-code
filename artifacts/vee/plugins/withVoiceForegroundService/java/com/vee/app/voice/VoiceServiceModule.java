package com.vee.app.voice;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.facebook.react.bridge.Promise;
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

  /**
   * 2026-10-22 (boss): battery-optimization exemption. Aggressive OEM power
   * managers kill backgrounded apps even with a foreground service; being on
   * the battery whitelist is the standard IMO/WhatsApp defence. JS asks
   * once (AsyncStorage-gated) when the user joins a room.
   */
  @ReactMethod
  public void isIgnoringBatteryOptimizations(Promise promise) {
    try {
      if (Build.VERSION.SDK_INT < 23) {
        promise.resolve(true);
        return;
      }
      ReactApplicationContext ctx = getReactApplicationContext();
      PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
      promise.resolve(pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
    } catch (Exception e) {
      promise.resolve(false);
    }
  }

  @ReactMethod
  public void openBatteryOptimizationSettings() {
    try {
      ReactApplicationContext ctx = getReactApplicationContext();
      Activity activity = ctx.getCurrentActivity();
      if (Build.VERSION.SDK_INT >= 23) {
        try {
          Intent direct = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
          direct.setData(Uri.parse("package:" + ctx.getPackageName()));
          direct.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
          if (activity != null) {
            activity.startActivity(direct);
          } else {
            ctx.startActivity(direct);
          }
          return;
        } catch (Exception ignored) {
          // Some OEMs block the direct intent — fall through to the list.
        }
      }
      Intent list = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
      list.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      if (activity != null) {
        activity.startActivity(list);
      } else {
        ctx.startActivity(list);
      }
    } catch (Exception ignored) {
    }
  }
}
