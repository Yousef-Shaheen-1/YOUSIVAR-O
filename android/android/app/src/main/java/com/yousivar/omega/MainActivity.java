package com.yousivar.omega;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * The YOUSIVAR–Ω shell activity.
 *
 * External links and in-app navigation need no code here: Capacitor already
 * opens any URL whose host or scheme differs from the loaded application in the
 * system browser, and keeps same-origin navigation inside the WebView. That is
 * the security boundary we want — page content never gets native privileges.
 *
 * What Capacitor does not do on its own is Android's hardware back button, so
 * it is handled here: it walks the WebView history first and only leaves the
 * application from its own home surface.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        // At the application's own root: send the task to the background so a
        // mis-tap never destroys the session, and reopening is instant.
        if (webView != null) {
            moveTaskToBack(true);
            return;
        }
        super.onBackPressed();
    }
}
