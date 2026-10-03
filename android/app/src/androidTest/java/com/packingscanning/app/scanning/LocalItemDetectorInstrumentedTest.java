package com.packingscanning.app.scanning;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.JSONObject;

/** Compiles in the test APK; requires a connected device to prove Android inference. */
public class LocalItemDetectorInstrumentedTest {
    @Test public void bundledModelRunsAndDiscardsBlankFrame() throws Exception {
        byte[] rgb=new byte[320*320*3];java.util.Arrays.fill(rgb,(byte)128);
        JSONObject result=LocalItemDetector.detect(InstrumentationRegistry.getInstrumentation().getTargetContext().getAssets(),rgb);
        assertEquals("complete",result.getString("status"));assertEquals(0,result.getJSONArray("candidates").length());
        for(byte b:rgb)assertEquals(0,b);
    }
    @Test public void malformedImageIsErasedAndNeverBecomesASuggestion() throws Exception {
        byte[] rgb={1,2,3};
        try{LocalItemDetector.detect(InstrumentationRegistry.getInstrumentation().getTargetContext().getAssets(),rgb);fail();}catch(IllegalArgumentException expected){}
        for(byte b:rgb)assertEquals(0,b);
    }
}
