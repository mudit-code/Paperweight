package com.paperweight.app;

import android.Manifest;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.DisplayCutout;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final int CAMERA_PERMISSION_REQUEST = 1001;
    private volatile String pendingSharedImagesJson = null;
    private volatile String pendingPdfJson = null;
    private volatile boolean hasPendingPdf = false;
    private volatile String pendingPdfFileName = null;

    public int getStatusBarAndCutoutHeightDp() {
        int heightPx = 0;

        // 1. Framework static status_bar_height resource - always available synchronously on all Android devices
        try {
            int resourceId = getResources().getIdentifier("status_bar_height", "dimen", "android");
            if (resourceId > 0) {
                heightPx = getResources().getDimensionPixelSize(resourceId);
            }
        } catch (Exception ignored) {}

        // 2. WindowMetrics cutout / status bars on modern Android (API 30+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                WindowInsets windowInsets = getWindowManager().getCurrentWindowMetrics().getWindowInsets();
                WindowInsetsCompat insetsCompat = WindowInsetsCompat.toWindowInsetsCompat(windowInsets, getWindow().getDecorView());
                Insets insets = insetsCompat.getInsets(WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.displayCutout());
                if (insets.top > 0) {
                    heightPx = Math.max(heightPx, insets.top);
                }
            } catch (Exception ignored) {}
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                if (getWindow().getDecorView().getRootWindowInsets() != null) {
                    DisplayCutout cutout = getWindow().getDecorView().getRootWindowInsets().getDisplayCutout();
                    if (cutout != null) {
                        heightPx = Math.max(heightPx, cutout.getSafeInsetTop());
                    }
                }
            } catch (Exception ignored) {}
        }

        float density = getResources().getDisplayMetrics().density;
        int dp = Math.round(heightPx / density);
        return Math.max(24, dp); // Never 0 on Android; at least 24dp
    }

    public int getNavigationBarHeightDp() {
        int heightPx = 0;
        try {
            int resourceId = getResources().getIdentifier("navigation_bar_height", "dimen", "android");
            if (resourceId > 0) {
                heightPx = getResources().getDimensionPixelSize(resourceId);
            }
        } catch (Exception ignored) {}

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                WindowInsets windowInsets = getWindowManager().getCurrentWindowMetrics().getWindowInsets();
                WindowInsetsCompat insetsCompat = WindowInsetsCompat.toWindowInsetsCompat(windowInsets, getWindow().getDecorView());
                Insets insets = insetsCompat.getInsets(WindowInsetsCompat.Type.navigationBars());
                if (insets.bottom > 0) {
                    heightPx = Math.max(heightPx, insets.bottom);
                }
            } catch (Exception ignored) {}
        }

        float density = getResources().getDisplayMetrics().density;
        int dp = Math.round(heightPx / density);
        return Math.max(0, dp);
    }

    public void injectSafeAreas() {
        injectSafeAreasWithValues(getStatusBarAndCutoutHeightDp(), getNavigationBarHeightDp());
    }

    public void injectSafeAreasWithValues(final int topDp, final int bottomDp) {
        if (getBridge() != null && getBridge().getWebView() != null) {
            final String js = String.format(
                Locale.US,
                "(function() {" +
                "  try {" +
                "    var r = document.documentElement;" +
                "    r.style.setProperty('--safe-area-inset-top', '%dpx');" +
                "    r.style.setProperty('--safe-area-inset-bottom', '%dpx');" +
                "  } catch(e) {}" +
                "})()",
                topDp, bottomDp
            );
            getBridge().getWebView().post(() -> {
                getBridge().getWebView().evaluateJavascript(js, null);
            });
        }
    }

    private void updateWindowThemeBackground(boolean isDark) {
        int themeBgColor = isDark ? Color.parseColor("#151517") : Color.parseColor("#E9E8E4");
        getWindow().setBackgroundDrawable(new ColorDrawable(themeBgColor));
        getWindow().getDecorView().setBackgroundColor(themeBgColor);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        // Process incoming shared images on cold start
        handleIncomingIntent(getIntent());

        // 1. Enable true Edge-to-Edge layout across all Android versions
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);

        // Keep the splash background active on the window until web content has painted its first frame.
        // This eliminates the blank screen delay/flash during startup!

        // 2. Make WebView background transparent so web content seamlessly renders edge-to-edge
        // and clear web cache on start so updated assets in new APKs load immediately
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
            getBridge().getWebView().clearCache(true);
        }

        // 3. Force 0 padding on root views and zero out system insets to prevent CoordinatorLayout
        // or other Android view containers from pushing the WebView down
        ViewCompat.setOnApplyWindowInsetsListener(window.getDecorView(), (v, windowInsets) -> {
            v.setPadding(0, 0, 0, 0);

            View content = v.findViewById(android.R.id.content);
            if (content != null) {
                content.setPadding(0, 0, 0, 0);
            }

            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                webView.setPadding(0, 0, 0, 0);
                if (webView.getParent() instanceof ViewGroup) {
                    ((ViewGroup) webView.getParent()).setPadding(0, 0, 0, 0);
                }
            }

            // Inject safe-area CSS custom properties directly from insets
            Insets statusInsets = windowInsets.getInsets(WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.displayCutout());
            Insets navInsets = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
            float density = getResources().getDisplayMetrics().density;
            int topDp = Math.round(statusInsets.top / density);
            int bottomDp = Math.round(navInsets.bottom / density);
            if (topDp <= 0) topDp = getStatusBarAndCutoutHeightDp();
            if (bottomDp < 0) bottomDp = getNavigationBarHeightDp();
            injectSafeAreasWithValues(topDp, bottomDp);

            // CRITICAL: Consume/zero system bars and display cutout insets so downstream views
            // (such as CoordinatorLayout) do not apply native padding above/below WebView!
            return new WindowInsetsCompat.Builder(windowInsets)
                .setInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout(), Insets.of(0, 0, 0, 0))
                .build();
        });

        // Ensure insets are injected when page loads or becomes visible, then smoothly transition theme background
        if (getBridge() != null) {
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public void onPageCommitVisible(WebView view, String url) {
                    injectSafeAreas();
                    int nightMode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
                    updateWindowThemeBackground(nightMode == Configuration.UI_MODE_NIGHT_YES);
                }

                @Override
                public void onPageLoaded(WebView view) {
                    injectSafeAreas();
                    int nightMode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
                    updateWindowThemeBackground(nightMode == Configuration.UI_MODE_NIGHT_YES);
                    if (pendingPdfJson != null) {
                        view.postDelayed(() -> {
                            view.evaluateJavascript("window.dispatchEvent(new CustomEvent('paperweightOpenPdf'));", null);
                        }, 100);
                    }
                    if (pendingSharedImagesJson != null) {
                        view.postDelayed(() -> {
                            view.evaluateJavascript("window.dispatchEvent(new CustomEvent('paperweightSharedImages'));", null);
                        }, 100);
                    }
                }
            });
        }

        // Intercept Android hardware back button and gesture navigation
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                        "(function() { " +
                        "  var evt = new CustomEvent('hardwareBackPress', { cancelable: true }); " +
                        "  var handled = !window.dispatchEvent(evt); " +
                        "  return handled; " +
                        "})()",
                        result -> {
                            if ("false".equals(result)) {
                                moveTaskToBack(true);
                            }
                        }
                    );
                } else {
                    moveTaskToBack(true);
                }
            }
        });

        // Prompt for Camera Permission on start
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
        }

        // Register Native Android Bridge for offline file saving, sharing, safe-area metrics, and theme sync
        if (this.getBridge() != null && this.getBridge().getWebView() != null) {
            this.getBridge().getWebView().addJavascriptInterface(new Object() {
                @JavascriptInterface
                public int getStatusBarHeight() {
                    return getStatusBarAndCutoutHeightDp();
                }

                @JavascriptInterface
                public int getNavigationBarHeight() {
                    return getNavigationBarHeightDp();
                }

                @JavascriptInterface
                public void setAppTheme(boolean isDark) {
                    runOnUiThread(() -> updateWindowThemeBackground(isDark));
                }

                @JavascriptInterface
                public boolean saveFile(String base64Data, String filename, String mimeType) {
                    try {
                        byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                        boolean isImage = (mimeType != null && mimeType.startsWith("image/")) ||
                                          filename.toLowerCase().matches(".*\\.(jpe?g|png|webp|avif|bmp|gif|tiff?)");

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            ContentValues values = new ContentValues();
                            values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
                            values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType != null && !mimeType.isEmpty() ? mimeType : (isImage ? "image/png" : "application/octet-stream"));
                            values.put(MediaStore.MediaColumns.RELATIVE_PATH, isImage ? (Environment.DIRECTORY_PICTURES + "/Paperweight") : Environment.DIRECTORY_DOWNLOADS);

                            Uri targetCollection = isImage ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI : MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                            Uri uri = getContentResolver().insert(targetCollection, values);
                            if (uri != null) {
                                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                                    if (os != null) {
                                        os.write(bytes);
                                        os.flush();
                                    }
                                }
                            }
                        } else {
                            File baseDir = isImage ? Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES) : Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                            File targetDir = isImage ? new File(baseDir, "Paperweight") : baseDir;
                            if (!targetDir.exists()) targetDir.mkdirs();
                            File file = new File(targetDir, filename);
                            try (FileOutputStream fos = new FileOutputStream(file)) {
                                fos.write(bytes);
                                fos.flush();
                            }
                            android.media.MediaScannerConnection.scanFile(
                                MainActivity.this,
                                new String[] { file.getAbsolutePath() },
                                new String[] { mimeType },
                                null
                            );
                        }

                        runOnUiThread(() -> {
                            Toast.makeText(MainActivity.this, isImage ? ("Saved " + filename + " to Gallery") : ("Saved " + filename + " to Downloads"), Toast.LENGTH_LONG).show();
                        });
                        return true;
                    } catch (Exception e) {
                        e.printStackTrace();
                        runOnUiThread(() -> {
                            Toast.makeText(MainActivity.this, "Error saving file: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                        });
                        return false;
                    }
                }

                @JavascriptInterface
                public boolean saveFiles(String[] base64DataList, String[] filenames, String[] mimeTypes) {
                    if (base64DataList == null || filenames == null || base64DataList.length == 0) {
                        return false;
                    }
                    int savedCount = 0;
                    boolean anyImage = false;
                    for (int i = 0; i < base64DataList.length; i++) {
                        try {
                            String base64Data = base64DataList[i];
                            String filename = (i < filenames.length) ? filenames[i] : ("file_" + (i + 1));
                            String mimeType = (mimeTypes != null && i < mimeTypes.length && mimeTypes[i] != null && !mimeTypes[i].isEmpty())
                                    ? mimeTypes[i] : "application/octet-stream";

                            boolean isImage = (mimeType != null && mimeType.startsWith("image/")) ||
                                              filename.toLowerCase().matches(".*\\.(jpe?g|png|webp|avif|bmp|gif|tiff?)");
                            if (isImage) anyImage = true;

                            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);

                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                                ContentValues values = new ContentValues();
                                values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
                                values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                                values.put(MediaStore.MediaColumns.RELATIVE_PATH, isImage ? (Environment.DIRECTORY_PICTURES + "/Paperweight") : Environment.DIRECTORY_DOWNLOADS);

                                Uri targetCollection = isImage ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI : MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                                Uri uri = getContentResolver().insert(targetCollection, values);
                                if (uri != null) {
                                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                                        if (os != null) {
                                            os.write(bytes);
                                            os.flush();
                                            savedCount++;
                                        }
                                    }
                                }
                            } else {
                                File baseDir = isImage ? Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES) : Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                                File targetDir = isImage ? new File(baseDir, "Paperweight") : baseDir;
                                if (!targetDir.exists()) targetDir.mkdirs();
                                File file = new File(targetDir, filename);
                                try (FileOutputStream fos = new FileOutputStream(file)) {
                                    fos.write(bytes);
                                    fos.flush();
                                    savedCount++;
                                }
                                android.media.MediaScannerConnection.scanFile(
                                    MainActivity.this,
                                    new String[] { file.getAbsolutePath() },
                                    new String[] { mimeType },
                                    null
                                );
                            }
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                    }

                    final int finalCount = savedCount;
                    final boolean isImg = anyImage;
                    runOnUiThread(() -> {
                        if (finalCount > 0) {
                            String targetName = isImg ? "Gallery" : "Downloads";
                            Toast.makeText(MainActivity.this, "Saved " + finalCount + " files to " + targetName, Toast.LENGTH_LONG).show();
                        } else {
                            Toast.makeText(MainActivity.this, "Error saving files", Toast.LENGTH_SHORT).show();
                        }
                    });
                    return savedCount > 0;
                }

                @JavascriptInterface
                public boolean shareFile(String base64Data, String filename, String mimeType, String caption) {
                    try {
                        byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                        File cacheDir = new File(getCacheDir(), "shared_docs");
                        if (!cacheDir.exists()) cacheDir.mkdirs();

                        File shareFile = new File(cacheDir, filename);
                        try (FileOutputStream fos = new FileOutputStream(shareFile)) {
                            fos.write(bytes);
                            fos.flush();
                        }

                        Uri fileUri = FileProvider.getUriForFile(
                            MainActivity.this,
                            getPackageName() + ".fileprovider",
                            shareFile
                        );

                        Intent shareIntent = new Intent(Intent.ACTION_SEND);
                        shareIntent.setType(mimeType != null && !mimeType.isEmpty() ? mimeType : "application/octet-stream");
                        shareIntent.putExtra(Intent.EXTRA_STREAM, fileUri);
                        if (caption != null && !caption.isEmpty()) {
                            shareIntent.putExtra(Intent.EXTRA_TEXT, caption);
                        }
                        shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                        Intent chooser = Intent.createChooser(shareIntent, "Share Document");
                        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(chooser);
                        return true;
                    } catch (Exception e) {
                        e.printStackTrace();
                        runOnUiThread(() -> {
                            Toast.makeText(MainActivity.this, "Share error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                        });
                        return false;
                    }
                }

                @JavascriptInterface
                public boolean shareFiles(String[] base64DataList, String[] filenames, String[] mimeTypes, String caption) {
                    try {
                        if (base64DataList == null || filenames == null || base64DataList.length == 0) {
                            return false;
                        }
                        File cacheDir = new File(getCacheDir(), "shared_docs");
                        if (!cacheDir.exists()) cacheDir.mkdirs();

                        ArrayList<Uri> fileUris = new ArrayList<>();
                        String commonMimeType = "application/octet-stream";
                        if (mimeTypes != null && mimeTypes.length > 0 && mimeTypes[0] != null && !mimeTypes[0].isEmpty()) {
                            commonMimeType = mimeTypes[0];
                        }

                        for (int i = 0; i < base64DataList.length; i++) {
                            byte[] bytes = Base64.decode(base64DataList[i], Base64.DEFAULT);
                            String filename = (i < filenames.length) ? filenames[i] : ("image_" + (i + 1) + ".png");
                            File shareFile = new File(cacheDir, filename);
                            try (FileOutputStream fos = new FileOutputStream(shareFile)) {
                                fos.write(bytes);
                                fos.flush();
                            }
                            Uri fileUri = FileProvider.getUriForFile(
                                MainActivity.this,
                                getPackageName() + ".fileprovider",
                                shareFile
                            );
                            fileUris.add(fileUri);
                        }

                        Intent shareIntent = new Intent(Intent.ACTION_SEND_MULTIPLE);
                        shareIntent.setType(commonMimeType);
                        shareIntent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, fileUris);
                        if (caption != null && !caption.isEmpty()) {
                            shareIntent.putExtra(Intent.EXTRA_TEXT, caption);
                        }
                        shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                        Intent chooser = Intent.createChooser(shareIntent, "Share Images");
                        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(chooser);
                        return true;
                    } catch (Exception e) {
                        e.printStackTrace();
                        runOnUiThread(() -> {
                            Toast.makeText(MainActivity.this, "Share error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                        });
                        return false;
                    }
                }

                @JavascriptInterface
                public String getPendingSharedImages() {
                    return pendingSharedImagesJson != null ? pendingSharedImagesJson : "";
                }

                @JavascriptInterface
                public void clearPendingSharedImages() {
                    pendingSharedImagesJson = null;
                }

                @JavascriptInterface
                public boolean hasPendingPdf() {
                    return hasPendingPdf;
                }

                @JavascriptInterface
                public String getPendingPdfName() {
                    return pendingPdfFileName != null ? pendingPdfFileName : "Document.pdf";
                }

                @JavascriptInterface
                public String getPendingPdf() {
                    return pendingPdfJson != null ? pendingPdfJson : "";
                }

                @JavascriptInterface
                public void clearPendingPdf() {
                    pendingPdfJson = null;
                    hasPendingPdf = false;
                    pendingPdfFileName = null;
                }

                @JavascriptInterface
                public String readCachedPdfBase64() {
                    try {
                        File cacheDir = new File(getCacheDir(), "opened_pdfs");
                        File cachedPdf = new File(cacheDir, "incoming_opened.pdf");
                        if (!cachedPdf.exists()) return "";
                        byte[] b = new byte[(int) cachedPdf.length()];
                        try (InputStream fis = new java.io.FileInputStream(cachedPdf)) {
                            int r = 0;
                            while (r < b.length) {
                                int n = fis.read(b, r, b.length - r);
                                if (n == -1) break;
                                r += n;
                            }
                        }
                        return Base64.encodeToString(b, Base64.NO_WRAP);
                    } catch (Exception e) {
                        return "";
                    }
                }
            }, "AndroidBridge");
        }

        // Handle incoming intent on cold start (e.g. opened via "Open with" or Share Sheet)
        handleIncomingIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private Uri extractIncomingUri(Intent intent) {
        if (intent == null) return null;
        Uri uri = intent.getData();
        if (uri != null) return uri;

        if (intent.getClipData() != null && intent.getClipData().getItemCount() > 0) {
            for (int i = 0; i < intent.getClipData().getItemCount(); i++) {
                Uri itemUri = intent.getClipData().getItemAt(i).getUri();
                if (itemUri != null) return itemUri;
            }
        }

        if (intent.hasExtra(Intent.EXTRA_STREAM)) {
            try {
                Uri streamUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (streamUri != null) return streamUri;
            } catch (Exception ignored) {}
        }
        return null;
    }

    private boolean isPdfUri(Uri uri, String intentType) {
        if (uri == null) return false;
        if (intentType != null && intentType.toLowerCase(Locale.ROOT).contains("pdf")) {
            return true;
        }
        try {
            String mime = getContentResolver().getType(uri);
            if (mime != null && mime.toLowerCase(Locale.ROOT).contains("pdf")) {
                return true;
            }
        } catch (Exception ignored) {}
        String uriStr = uri.toString().toLowerCase(Locale.ROOT);
        if (uriStr.contains(".pdf")) {
            return true;
        }
        try (android.database.Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String name = cursor.getString(idx);
                    if (name != null && name.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
                        return true;
                    }
                }
            }
        } catch (Exception ignored) {}
        try (InputStream is = getContentResolver().openInputStream(uri)) {
            if (is != null) {
                byte[] header = new byte[4];
                int read = is.read(header);
                if (read == 4 && header[0] == 0x25 && header[1] == 0x50 && header[2] == 0x44 && header[3] == 0x46) {
                    return true;
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    private String extractFileName(Uri uri) {
        if (uri == null) return "Document.pdf";
        String fileName = "Document.pdf";
        if (uri.getLastPathSegment() != null) {
            fileName = uri.getLastPathSegment();
        }
        try (android.database.Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String queryName = cursor.getString(idx);
                    if (queryName != null && !queryName.trim().isEmpty()) {
                        fileName = queryName;
                    }
                }
            }
        } catch (Exception ignored) {}
        if (!fileName.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
            fileName += ".pdf";
        }
        return fileName;
    }

    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();

        // 1. In-App PDF Viewer Intent: ACTION_VIEW from file managers or system "Open with"
        if (Intent.ACTION_VIEW.equals(action)) {
            Uri pdfUri = extractIncomingUri(intent);
            if (pdfUri != null) {
                hasPendingPdf = true;
                pendingPdfFileName = extractFileName(pdfUri);
                processIncomingPdf(pdfUri);
                return;
            }
        }

        // 2. ACTION_SEND for PDF
        if (Intent.ACTION_SEND.equals(action)) {
            Uri pdfUri = extractIncomingUri(intent);
            if (pdfUri != null && isPdfUri(pdfUri, type)) {
                hasPendingPdf = true;
                pendingPdfFileName = extractFileName(pdfUri);
                processIncomingPdf(pdfUri);
                return;
            }
        }

        // 3. ACTION_SEND / ACTION_SEND_MULTIPLE for Images
        if (Intent.ACTION_SEND.equals(action) && type != null && type.startsWith("image/")) {
            Uri imageUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (imageUri != null) {
                processSharedUris(Collections.singletonList(imageUri));
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action) && type != null && type.startsWith("image/")) {
            ArrayList<Uri> imageUris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (imageUris != null && !imageUris.isEmpty()) {
                processSharedUris(imageUris);
            }
        }
    }

    private void processIncomingPdf(final Uri pdfUri) {
        new Thread(() -> {
            try {
                String fileName = "document.pdf";
                if (pdfUri.getLastPathSegment() != null) {
                    fileName = pdfUri.getLastPathSegment();
                }
                try (android.database.Cursor cursor = getContentResolver().query(pdfUri, null, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        if (nameIndex >= 0) {
                            String queryName = cursor.getString(nameIndex);
                            if (queryName != null && !queryName.trim().isEmpty()) {
                                fileName = queryName;
                            }
                        }
                    }
                } catch (Exception ignored) {}

                if (!fileName.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
                    fileName += ".pdf";
                }

                File cacheDir = new File(getCacheDir(), "opened_pdfs");
                if (!cacheDir.exists()) cacheDir.mkdirs();
                File cachedPdf = new File(cacheDir, "incoming_opened.pdf");

                try (InputStream is = getContentResolver().openInputStream(pdfUri);
                     FileOutputStream fos = new FileOutputStream(cachedPdf)) {
                    if (is == null) return;
                    byte[] temp = new byte[32768];
                    int nRead;
                    while ((nRead = is.read(temp, 0, temp.length)) != -1) {
                        fos.write(temp, 0, nRead);
                    }
                    fos.flush();
                }

                if (cachedPdf.exists() && cachedPdf.length() > 0) {
                    JSONObject obj = new JSONObject();
                    obj.put("name", fileName);
                    obj.put("filePath", cachedPdf.getAbsolutePath());
                    obj.put("size", cachedPdf.length());

                    // If file is reasonably sized (<= 2MB), also include Base64 for instant zero-fetch loading
                    if (cachedPdf.length() <= 2 * 1024 * 1024) {
                        byte[] bytes = new byte[(int) cachedPdf.length()];
                        try (InputStream fis = new java.io.FileInputStream(cachedPdf)) {
                            int r = 0;
                            while (r < bytes.length) {
                                int n = fis.read(bytes, r, bytes.length - r);
                                if (n == -1) break;
                                r += n;
                            }
                        }
                        obj.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                    }

                    pendingPdfJson = obj.toString();

                    runOnUiThread(() -> {
                        if (getBridge() != null && getBridge().getWebView() != null) {
                            getBridge().getWebView().evaluateJavascript(
                                "(function() { " +
                                "  try { " +
                                "    window.dispatchEvent(new CustomEvent('paperweightOpenPdf')); " +
                                "  } catch(e) {} " +
                                "})();",
                                null
                            );
                        }
                    });
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }).start();
    }

    private void processSharedUris(final List<Uri> uris) {
        new Thread(() -> {
            JSONArray jsonArray = new JSONArray();
            int idx = 1;
            for (Uri uri : uris) {
                if (uri == null) continue;
                try {
                    String fileName = "shared_image_" + idx + ".jpg";
                    if (uri.getLastPathSegment() != null) {
                        fileName = uri.getLastPathSegment();
                    }
                    String mimeType = getContentResolver().getType(uri);
                    if (mimeType == null || mimeType.trim().isEmpty()) {
                        mimeType = "image/jpeg";
                    }

                    try (android.database.Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                        if (cursor != null && cursor.moveToFirst()) {
                            int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                            if (nameIndex >= 0) {
                                String queryName = cursor.getString(nameIndex);
                                if (queryName != null && !queryName.trim().isEmpty()) {
                                    fileName = queryName;
                                }
                            }
                        }
                    } catch (Exception ignored) {}

                    byte[] bytes;
                    try (InputStream is = getContentResolver().openInputStream(uri)) {
                        if (is == null) continue;
                        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                        byte[] temp = new byte[16384];
                        int nRead;
                        while ((nRead = is.read(temp, 0, temp.length)) != -1) {
                            buffer.write(temp, 0, nRead);
                        }
                        buffer.flush();
                        bytes = buffer.toByteArray();
                    }

                    if (bytes.length > 0) {
                        String base64Data = Base64.encodeToString(bytes, Base64.NO_WRAP);
                        String dataUrl = "data:" + mimeType + ";base64," + base64Data;

                        JSONObject obj = new JSONObject();
                        obj.put("name", fileName);
                        obj.put("mimeType", mimeType);
                        obj.put("dataUrl", dataUrl);
                        jsonArray.put(obj);
                        idx++;
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }

            if (jsonArray.length() > 0) {
                pendingSharedImagesJson = jsonArray.toString();

                runOnUiThread(() -> {
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        getBridge().getWebView().evaluateJavascript(
                            "(function() { " +
                            "  try { " +
                            "    window.dispatchEvent(new CustomEvent('paperweightSharedImages')); " +
                            "  } catch(e) {} " +
                            "})();",
                            null
                        );
                    }
                });
            }
        }).start();
    }
}
