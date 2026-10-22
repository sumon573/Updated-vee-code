package com.vee.app.voice;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * 2026-10-15 (Sumon): keeps voice alive in background.
 * Android blocks mic access for backgrounded apps — a foreground service of
 * type "microphone" is the OS-sanctioned way to keep talking + hearing when
 * the app is backgrounded (like IMO/WhatsApp calls). Shows a low-key
 * ongoing notification; tapping it reopens the app.
 */
public class VoiceForegroundService extends Service {
  public static final String CHANNEL_ID = "vee_voice_service";
  public static final int NOTIF_ID = 7001;
  public static final String EXTRA_TITLE = "title";

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
    if (title == null || title.isEmpty()) {
      title = "Voice active";
    }

    createChannel();

    PendingIntent contentIntent = null;
    try {
      Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
      if (launch != null) {
        int flags2 = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) {
          flags2 |= PendingIntent.FLAG_IMMUTABLE;
        }
        contentIntent = PendingIntent.getActivity(this, 0, launch, flags2);
      }
    } catch (Exception ignored) {
    }

    int icon = android.R.drawable.stat_sys_data_bluetooth;
    try {
      int appIcon = getApplicationInfo().icon;
      if (appIcon != 0) {
        icon = appIcon;
      }
    } catch (Exception ignored) {
    }

    NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("Vee")
        .setContentText(title)
        .setSmallIcon(icon)
        .setOngoing(true)
        .setPriority(NotificationCompat.PRIORITY_LOW);
    if (contentIntent != null) {
      b.setContentIntent(contentIntent);
    }

    Notification notif = b.build();
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
    } else {
      startForeground(NOTIF_ID, notif);
    }
    // 2026-10-22 (boss): STICKY — if the OEM task killer reaps the process
    // mid-room/call, Android restarts the service (null intent → default
    // title) instead of leaving voice permanently dead until the user
    // reopens the app. NOT_STICKY let aggressive OEMs (HiOS/Tecno etc.)
    // kill background voice for good.
    return START_STICKY;
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel ch = new NotificationChannel(
          CHANNEL_ID,
          "Voice calls",
          NotificationManager.IMPORTANCE_LOW);
      ch.setDescription("Keeps your voice room or call alive in the background");
      try {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
          nm.createNotificationChannel(ch);
        }
      } catch (Exception ignored) {
      }
    }
  }

  @Override
  public void onDestroy() {
    try {
      if (Build.VERSION.SDK_INT >= 24) {
        stopForeground(STOP_FOREGROUND_REMOVE);
      } else {
        stopForeground(true);
      }
    } catch (Exception ignored) {
    }
    super.onDestroy();
  }
}
