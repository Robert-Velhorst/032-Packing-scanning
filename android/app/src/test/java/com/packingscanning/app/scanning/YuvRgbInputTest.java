package com.packingscanning.app.scanning;
import org.junit.Test;
import static org.junit.Assert.*;
import java.nio.ByteBuffer;

public class YuvRgbInputTest {
    @Test public void samplesIndependentPaddedPlanesAndNonzeroBufferPositions(){
        ByteBuffer y=ByteBuffer.wrap(new byte[]{0,16,(byte)235,0,0,81,(byte)145,0,0});y.position(1);
        ByteBuffer u=ByteBuffer.wrap(new byte[]{0,(byte)128,0});u.position(1);ByteBuffer v=u.duplicate();
        byte[] out=YuvRgbInput.sample(new ByteBuffer[]{y,u,v},new int[]{4,2,2},new int[]{1,2,2},2,2,new float[]{0,0,2,0,0,2},2);
        assertEquals(0,out[0]&255);assertEquals(255,out[3]&255);assertEquals(76,out[6]&255);assertEquals(150,out[9]&255);assertEquals(1,y.position());
    }
    @Test public void followsRotatedViewMappingWithoutRotatingDepthGeometry(){
        ByteBuffer y=ByteBuffer.wrap(new byte[]{16,(byte)235,81,(byte)145});ByteBuffer c=ByteBuffer.wrap(new byte[]{(byte)128});
        byte[] out=YuvRgbInput.sample(new ByteBuffer[]{y,c,c},new int[]{2,1,1},new int[]{1,1,1},2,2,new float[]{0,2,0,0,2,2},2);
        assertEquals(76,out[0]&255);assertEquals(0,out[3]&255);assertEquals(150,out[6]&255);assertEquals(255,out[9]&255);
    }
    @Test public void convertsLimitedRangeRedWithInterleavedChroma(){
        byte[] out=YuvRgbInput.sample(new ByteBuffer[]{ByteBuffer.wrap(new byte[]{81,81,81,81}),ByteBuffer.wrap(new byte[]{90,0}),ByteBuffer.wrap(new byte[]{(byte)240,0})},new int[]{2,2,2},new int[]{1,2,2},2,2,new float[]{0,0,2,0,0,2},1);
        assertTrue((out[0]&255)>=250);assertTrue((out[1]&255)<=2);assertTrue((out[2]&255)<=2);
    }
    @Test public void rejectsTruncatedPlanesAndOutOfImageCoordinates(){
        ByteBuffer[] p={ByteBuffer.wrap(new byte[]{16}),ByteBuffer.wrap(new byte[]{(byte)128}),ByteBuffer.wrap(new byte[]{(byte)128})};
        for(float[] corners:new float[][]{{0,0,2,0,0,2},{-4,0,-2,0,-4,2},{Float.NaN,0,2,0,0,2}})try{YuvRgbInput.sample(p,new int[]{2,1,1},new int[]{1,1,1},2,2,corners,2);fail();}catch(IllegalArgumentException expected){}
    }
}
