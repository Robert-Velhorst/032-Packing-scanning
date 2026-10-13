package com.packingscanning.app.files;
import org.junit.Test;
import java.io.IOException;
import static org.junit.Assert.*;
public class ReferenceCameraPolicyTest {
    @Test public void prefersTheLargestBoundedOutputAndUsesTheSmallestBoundedFallback()throws Exception{assertEquals(2,ReferenceCameraPolicy.chooseSize(new int[][]{{6000,4000},{640,480},{1920,1080},{3000,2000}}));assertEquals(1,ReferenceCameraPolicy.chooseSize(new int[][]{{4096,3000},{3000,2000}}));}
    @Test public void refusesUnboundedInvalidOrMissingOutputs(){assertThrows(IOException.class,()->ReferenceCameraPolicy.chooseSize(new int[][]{{10000,10000},{-1,480}}));assertThrows(IOException.class,()->ReferenceCameraPolicy.chooseSize(new int[][]{}));}
    @Test public void previewKeepsEveryCornerInBoundsWithoutChangingAspectRatioAcrossSensorsAndRotations(){
        for(int sensor:new int[]{0,90,180,270})for(int display:new int[]{0,90,180,270}){
            float[] scales=ReferenceCameraPolicy.previewScale(1920,1080,500,700,sensor,display);
            double naturalWidth=sensor%180==0?1920:1080,naturalHeight=sensor%180==0?1080:1920;
            double transformedWidth=500*scales[0],transformedHeight=700*scales[1];
            assertEquals(naturalWidth/naturalHeight,transformedWidth/transformedHeight,.00001);
            double width=display%180==0?transformedWidth:transformedHeight,height=display%180==0?transformedHeight:transformedWidth;
            assertTrue(width<=500.001);assertTrue(height<=700.001);assertTrue(Math.abs(width-500)<.001||Math.abs(height-700)<.001);
        }
        assertThrows(IllegalArgumentException.class,()->ReferenceCameraPolicy.previewScale(0,1080,500,700,90,0));
    }
    @Test public void orientationAccountsForSensorDisplayAndLensDirection(){assertEquals(90,ReferenceCameraPolicy.jpegOrientation(90,0,false));assertEquals(0,ReferenceCameraPolicy.jpegOrientation(90,90,false));assertEquals(270,ReferenceCameraPolicy.jpegOrientation(90,180,false));assertEquals(180,ReferenceCameraPolicy.jpegOrientation(90,90,true));}
}
