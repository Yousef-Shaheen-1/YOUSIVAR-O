package com.yousivar.omega;

import static org.junit.Assert.assertEquals;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Runs on a device or emulator and checks that the installed package is the
 * YOUSIVAR–Ω application rather than a renamed build.
 *
 * Run it with: cd android/android && ./gradlew connectedDebugAndroidTest
 * (requires an attached device or a running emulator).
 */
@RunWith(AndroidJUnit4.class)
public class PackageIdentityInstrumentedTest {

    @Test
    public void installedPackageIsTheOmegaApplication() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.yousivar.omega", appContext.getPackageName());
    }
}
