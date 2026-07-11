# Capacitor / WebView JS bridge — never strip these
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.annotation.PluginMethod public *;
}

# WebView JavaScript interface
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep source info for crash debugging
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Prevent stripping of Capacitor plugins
-keep class com.capacitorjs.** { *; }
-keep class com.sentryfi.** { *; }
