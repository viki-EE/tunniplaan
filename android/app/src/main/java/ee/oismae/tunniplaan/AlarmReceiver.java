package ee.oismae.tunniplaan;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * One alarm at a time: fires at the next lesson start/end (to refresh the widget) or reminder time,
 * then schedules the following one. Also re-arms itself after a reboot or app update.
 */
public class AlarmReceiver extends BroadcastReceiver {
    static final String ACTION_TICK = "ee.oismae.tunniplaan.TICK";
    static final String CHANNEL = "lessons";

    @Override
    public void onReceive(Context c, Intent intent) {
        Schedule d = Schedule.load(c);
        if (d.reminders) notifyDue(c, d, System.currentTimeMillis());
        LessonWidget.updateAll(c);
        scheduleNext(c);
    }

    static void scheduleNext(Context c) {
        Schedule d = Schedule.load(c);
        long now = System.currentTimeMillis(), next = Long.MAX_VALUE;
        for (Schedule.Item it : d.items) {
            if (d.reminders) {
                long r = it.s - d.minutes * 60_000L;
                if (r > now + 1000) next = Math.min(next, r);
            }
            if (it.s > now) next = Math.min(next, it.s);
            if (it.e > now) next = Math.min(next, it.e);
        }
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent i = new Intent(c, AlarmReceiver.class).setAction(ACTION_TICK);
        PendingIntent pi = PendingIntent.getBroadcast(c, 1, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        am.cancel(pi);
        if (next == Long.MAX_VALUE) return;
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next + 500, pi);
    }

    static void notifyDue(Context c, Schedule d, long now) {
        SharedPreferences p = Schedule.prefs(c);
        long last = p.getLong("lastNotified", 0);
        long newest = last;
        for (Schedule.Item it : d.items) {
            long r = it.s - d.minutes * 60_000L;
            if (r <= now + 30_000 && it.s > now - 60_000 && it.s > last) {
                show(c, d, it);
                newest = Math.max(newest, it.s);
            }
        }
        if (newest != last) p.edit().putLong("lastNotified", newest).apply();
    }

    static void show(Context c, Schedule d, Schedule.Item it) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, c.getString(R.string.channel_name), NotificationManager.IMPORTANCE_DEFAULT));
            b = new Notification.Builder(c, CHANNEL);
        } else {
            b = new Notification.Builder(c);
        }
        String room = it.r.isEmpty() ? "" : d.str("room", "Room") + " " + it.r;
        b.setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(it.t + " · " + Schedule.hm(it.s))
                .setContentText(Schedule.join(room, it.x))
                .setWhen(it.s)
                .setShowWhen(true)
                .setAutoCancel(true)
                .setColor(0xFF7C5CFF)
                .setContentIntent(Schedule.openApp(c));
        try {
            nm.notify((int) ((it.s / 60_000L) % Integer.MAX_VALUE), b.build());
        } catch (SecurityException ignored) {
            // notifications not allowed
        }
    }
}
