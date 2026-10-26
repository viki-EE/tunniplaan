package ee.oismae.tunniplaan;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.widget.FrameLayout;
import android.widget.Toast;

/** A full-screen WebView around the live site, plus a small bridge for the widget, reminders and sharing. */
public class MainActivity extends Activity {
    static final String HOST = "viki-ee.github.io";
    static final String HOME = "https://" + HOST + "/tunniplaan/";

    private WebView web;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF090B12);
        web = new WebView(this);
        web.setBackgroundColor(0xFF090B12);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Android 15 draws apps edge-to-edge: keep the page clear of the status bar, nav bar and keyboard.
        root.setOnApplyWindowInsetsListener((v, ins) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                Insets i = ins.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                l = i.left; t = i.top; r = i.right; b = i.bottom;
            } else {
                l = ins.getSystemWindowInsetLeft(); t = ins.getSystemWindowInsetTop();
                r = ins.getSystemWindowInsetRight(); b = ins.getSystemWindowInsetBottom();
            }
            v.setPadding(l, t, r, b);
            return ins;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " TunniplaanApp/" + version());
        web.addJavascriptInterface(new Bridge(), "TunniplaanApp");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (isOwn(u)) return false;
                openExternal(u);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showOffline();
            }
        });

        if (saved != null && web.restoreState(saved) != null) {
            // restored
        } else {
            web.loadUrl(startUrl(getIntent()));
        }
        AlarmReceiver.scheduleNext(this);
        LessonWidget.updateAll(this);
    }

    private String startUrl(Intent i) {
        Uri u = i == null ? null : i.getData();
        return u != null && isOwn(u) ? u.toString() : HOME;
    }

    static boolean isOwn(Uri u) {
        if (u == null) return false;
        String path = u.getPath() == null ? "" : u.getPath();
        return "https".equals(u.getScheme()) && HOST.equalsIgnoreCase(u.getHost()) && path.startsWith("/tunniplaan");
    }

    private void openExternal(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app, Toast.LENGTH_SHORT).show();
        }
    }

    private void showOffline() {
        String html = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<body style='margin:0;background:#090b12;color:#eaedf8;font-family:sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center'>"
                + "<div style='padding:24px'><div style='font-size:44px'>📡</div><h2>" + getString(R.string.offline_title) + "</h2><p style='color:#8f98b8'>"
                + getString(R.string.offline_text) + "</p><button onclick=\"location.href='" + HOME + "'\" style='margin-top:12px;padding:12px 22px;border-radius:12px;border:0;"
                + "background:linear-gradient(135deg,#7c5cff,#22d3ee);color:#fff;font-size:16px;font-weight:700'>" + getString(R.string.retry) + "</button></div></body>";
        web.loadDataWithBaseURL(HOME, html, "text/html", "utf-8", HOME);
    }

    private String version() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1";
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("(window.appBack && window.appBack()) ? '1' : '0'", v -> {
            if ("\"1\"".equals(v)) return;
            if (web.canGoBack()) web.goBack();
            else finish();
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri u = intent.getData();
        if (u != null && isOwn(u)) web.loadUrl(u.toString());
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        web.evaluateJavascript("window.appResume && window.appResume()", null);
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** Called from the page as window.TunniplaanApp.* */
    final class Bridge {
        @JavascriptInterface
        public void setSchedule(String json) {
            Schedule.prefs(MainActivity.this).edit().putString("sched", json).apply();
            AlarmReceiver.scheduleNext(MainActivity.this);
            LessonWidget.updateAll(MainActivity.this);
        }

        @JavascriptInterface
        public void setReminders(boolean on) {
            if (on && Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7));
            }
        }

        @JavascriptInterface
        public void share(String title, String text) {
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
                        .putExtra(Intent.EXTRA_SUBJECT, title).putExtra(Intent.EXTRA_TEXT, text);
                try {
                    startActivity(Intent.createChooser(send, title));
                } catch (ActivityNotFoundException ignored) {
                }
            });
        }

        @JavascriptInterface
        public String version() {
            return MainActivity.this.version();
        }
    }
}
