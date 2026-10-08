package com.scmpharmacy.openchet

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.SystemClock
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var backInProgress = false
    private var lastExitPromptAt = 0L

    companion object {
        private const val HOME_URL = "https://open-chet.vercel.app/"
        private const val APP_HOST = "open-chet.vercel.app"
        private const val FILE_CHOOSER_REQUEST = 4201
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString OpenChetAndroid/1.0"
        }

        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return handleUri(request.url)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                this@MainActivity.fileChooserCallback?.onReceiveValue(null)
                this@MainActivity.fileChooserCallback = filePathCallback
                return try {
                    startActivityForResult(fileChooserParams.createIntent(), FILE_CHOOSER_REQUEST)
                    true
                } catch (_: ActivityNotFoundException) {
                    this@MainActivity.fileChooserCallback = null
                    Toast.makeText(this@MainActivity, "No file picker is available", Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }

        // Android 7–15+: register one lifecycle-aware handler for the system Back
        // button and the edge-swipe gesture, instead of relying on WebView history.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = handleBackPress()
        })

        if (savedInstanceState == null) {
            webView.loadUrl(HOME_URL)
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    private fun handleUri(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase()
        if ((scheme == "http" || scheme == "https") && uri.host == APP_HOST) {
            return false
        }

        return try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
            true
        } catch (_: Exception) {
            false
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            val result = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            fileChooserCallback?.onReceiveValue(result)
            fileChooserCallback = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    private fun handleBackPress() {
        if (isFinishing || isDestroyed || backInProgress) return
        backInProgress = true

        // The React workspace handles one in-app step first: overlay -> chat list
        // -> tool section -> root. WebView navigation is only the fallback.
        webView.evaluateJavascript(
            "(function(){try{return window.openChetNativeBack ? Boolean(window.openChetNativeBack()) : false;}catch(e){return false;}})();"
        ) { handled ->
            backInProgress = false
            if (isFinishing || isDestroyed) return@evaluateJavascript
            if (handled == "true") {
                lastExitPromptAt = 0L
                return@evaluateJavascript
            }

            // Never accidentally return from the inbox to the login screen.
            val history = webView.copyBackForwardList()
            val previous = if (history.currentIndex > 0) {
                history.getItemAtIndex(history.currentIndex - 1)?.url
            } else null
            val safePreviousPage = previous?.let { address ->
                val uri = Uri.parse(address)
                uri.host == APP_HOST && uri.path != "/login" && uri.path != "/"
            } ?: false

            if (safePreviousPage) {
                lastExitPromptAt = 0L
                webView.goBack()
                return@evaluateJavascript
            }

            // At the top-level Inbox, a single accidental Back must not close
            // the app. Allow an intentional double-back within two seconds.
            val now = SystemClock.elapsedRealtime()
            if (now - lastExitPromptAt <= 2000L) {
                finish()
            } else {
                lastExitPromptAt = now
                Toast.makeText(this, "Press Back again to exit Open Chet", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        webView.destroy()
        super.onDestroy()
    }
}
