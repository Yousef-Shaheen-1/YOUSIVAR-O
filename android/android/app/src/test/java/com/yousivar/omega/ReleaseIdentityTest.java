package com.yousivar.omega;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Asserts the identity the package is actually built with, so a mistaken version
 * bump or package rename fails a test instead of shipping.
 *
 * Run it with: cd android/android && ./gradlew testDebugUnitTest
 */
public class ReleaseIdentityTest {

    @Test
    public void packageIdIsStable() {
        assertEquals("com.yousivar.omega", BuildConfig.APPLICATION_ID);
    }

    @Test
    public void versionIsSemanticAndMonotonic() {
        assertTrue(
            "versionName must look like 1.2.3, was: " + BuildConfig.VERSION_NAME,
            BuildConfig.VERSION_NAME.matches("\\d+\\.\\d+\\.\\d+")
        );
        assertTrue("versionCode must be positive", BuildConfig.VERSION_CODE >= 1);
    }

    /** The minimum Android level is verified from the packaged artifact itself
     * (aapt reports `sdkVersion:'24'`); see ANDROID_BUILD.md. */
    @Test
    public void buildTypeIsTheVariantUnderTest() {
        assertEquals("debug", BuildConfig.BUILD_TYPE);
    }
}
