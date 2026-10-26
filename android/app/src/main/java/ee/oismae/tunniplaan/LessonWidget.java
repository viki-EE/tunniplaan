package ee.oismae.tunniplaan;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

/** Home-screen widget: the lesson going on now (or the next one) and the one after it. */
public class LessonWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context c, AppWidgetManager mgr, int[] ids) {
        RemoteViews v = build(c);
        for (int id : ids) mgr.updateAppWidget(id, v);
        AlarmReceiver.scheduleNext(c);
    }

    static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        if (m == null) return;
        int[] ids = m.getAppWidgetIds(new ComponentName(c, LessonWidget.class));
        if (ids == null || ids.length == 0) return;
        RemoteViews v = build(c);
        for (int id : ids) m.updateAppWidget(id, v);
    }

    static RemoteViews build(Context c) {
        Schedule d = Schedule.load(c);
        long now = System.currentTimeMillis();
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
        v.setOnClickPendingIntent(R.id.root, Schedule.openApp(c));
        v.setTextViewText(R.id.head, d.name.isEmpty() ? c.getString(R.string.app_name) : d.name);

        if (d.name.isEmpty()) {
            v.setTextViewText(R.id.nowlbl, "");
            v.setTextViewText(R.id.nowtitle, c.getString(R.string.pick));
            v.setTextViewText(R.id.nowsub, "");
            hideNext(v);
            return v;
        }

        Schedule.Item cur = d.current(now);
        Schedule.Item first = cur != null ? cur : d.nextAfter(now);
        if (first == null) {
            v.setTextViewText(R.id.nowlbl, "");
            v.setTextViewText(R.id.nowtitle, d.str("none", "No more lessons"));
            v.setTextViewText(R.id.nowsub, "");
            hideNext(v);
            return v;
        }
        String lbl = cur != null
                ? up(d.str("now", "Now"), d) + " · " + d.str("until", "until") + " " + Schedule.hm(cur.e)
                : up(d.str("next", "Next"), d) + " · " + d.when(first.s, now);
        v.setTextViewText(R.id.nowlbl, lbl);
        v.setTextViewText(R.id.nowtitle, first.t);
        v.setTextViewText(R.id.nowsub, Schedule.join(first.r, first.x));

        Schedule.Item after = d.nextAfter(first.s);
        if (after == null || !Schedule.sameDay(after.s, first.s)) {
            hideNext(v);
        } else {
            v.setViewVisibility(R.id.nextlbl, View.VISIBLE);
            v.setViewVisibility(R.id.nexttitle, View.VISIBLE);
            v.setTextViewText(R.id.nextlbl, up(cur != null ? d.str("next", "Next") : d.str("then", "Then"), d) + " · " + Schedule.hm(after.s));
            v.setTextViewText(R.id.nexttitle, Schedule.join(after.t, after.r));
        }
        return v;
    }

    private static String up(String s, Schedule d) {
        return s.toUpperCase(d.locale());
    }

    private static void hideNext(RemoteViews v) {
        v.setViewVisibility(R.id.nextlbl, View.GONE);
        v.setViewVisibility(R.id.nexttitle, View.GONE);
    }
}
