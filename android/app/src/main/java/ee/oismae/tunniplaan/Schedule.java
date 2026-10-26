package ee.oismae.tunniplaan;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** The selected timetable as sent by the web page (see appPayload() in index.html). */
final class Schedule {
    static final String PREFS = "tunniplaan";

    static final class Item {
        long s, e;
        String t = "", r = "", x = "";
    }

    String name = "", lang = "et";
    boolean reminders;
    int minutes = 5;
    JSONObject str = new JSONObject();
    final List<Item> items = new ArrayList<>();

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static Schedule load(Context c) {
        Schedule d = new Schedule();
        String raw = prefs(c).getString("sched", null);
        if (raw == null) return d;
        try {
            JSONObject j = new JSONObject(raw);
            d.name = j.optString("name", "");
            d.lang = j.optString("lang", "et");
            d.reminders = j.optBoolean("reminders", false);
            d.minutes = Math.max(1, j.optInt("minutes", 5));
            JSONObject s = j.optJSONObject("str");
            if (s != null) d.str = s;
            JSONArray a = j.optJSONArray("items");
            if (a != null) {
                for (int i = 0; i < a.length(); i++) {
                    JSONObject o = a.optJSONObject(i);
                    if (o == null) continue;
                    Item it = new Item();
                    it.s = o.optLong("s");
                    it.e = o.optLong("e");
                    it.t = o.optString("t", "");
                    it.r = o.optString("r", "");
                    it.x = o.optString("x", "");
                    if (it.s > 0 && it.e > it.s) d.items.add(it);
                }
            }
        } catch (Exception ignored) {
        }
        d.items.sort((p, q) -> Long.compare(p.s, q.s));
        return d;
    }

    String str(String k, String def) {
        String v = str.optString(k, "");
        return v.isEmpty() ? def : v;
    }

    Locale locale() {
        switch (lang) {
            case "en": return Locale.UK;
            case "ru": return new Locale("ru", "RU");
            case "uk": return new Locale("uk", "UA");
            default: return new Locale("et", "EE");
        }
    }

    Item current(long now) {
        for (Item it : items) if (it.s <= now && now < it.e) return it;
        return null;
    }

    Item nextAfter(long t) {
        for (Item it : items) if (it.s > t) return it;
        return null;
    }

    static String hm(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        return c.get(Calendar.HOUR_OF_DAY) + ":" + String.format(Locale.ROOT, "%02d", c.get(Calendar.MINUTE));
    }

    static boolean sameDay(long a, long b) {
        Calendar x = Calendar.getInstance(), y = Calendar.getInstance();
        x.setTimeInMillis(a);
        y.setTimeInMillis(b);
        return x.get(Calendar.YEAR) == y.get(Calendar.YEAR) && x.get(Calendar.DAY_OF_YEAR) == y.get(Calendar.DAY_OF_YEAR);
    }

    /** "9:45" today, otherwise "Mon 2 Nov 9:00" in the page's language. */
    String when(long ms, long now) {
        if (sameDay(ms, now)) return hm(ms);
        return new SimpleDateFormat("EEE d. MMM", locale()).format(new Date(ms)) + " " + hm(ms);
    }

    static String join(String a, String b) {
        if (a == null || a.isEmpty()) return b == null ? "" : b;
        if (b == null || b.isEmpty()) return a;
        return a + " · " + b;
    }

    static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
