package com.packingscanning.app.scanning;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.junit.Test;
import static org.junit.Assert.*;

public class DepthPixelsTest {
    @Test public void readsUnsignedLittleEndianAtPlanePositionWithPadding() {
        ByteBuffer d=ByteBuffer.allocate(30).order(ByteOrder.BIG_ENDIAN),c=ByteBuffer.allocate(25);
        d.position(3);d.limit(26);c.position(5);c.limit(21);
        d.put(3,(byte)0xff);d.put(4,(byte)0xff);d.put(7,(byte)0x34);d.put(8,(byte)0x12);
        d.put(15,(byte)0xe8);d.put(16,(byte)3);c.put(5,(byte)204);c.put(8,(byte)255);c.put(14,(byte)0);
        DepthPixels image=new DepthPixels(d,c,2,2,12,4,9,3);
        assertEquals(65535,image.millimetres(0,0));assertEquals(4660,image.millimetres(1,0));assertEquals(1000,image.millimetres(0,1));
        assertEquals(204,image.confidence(0,0));assertEquals(255,image.confidence(1,0));assertEquals(3,d.position());assertEquals(ByteOrder.BIG_ENDIAN,d.order());assertEquals(5,c.position());
    }
    @Test public void rejectsTruncatedAndInvalidLayoutsAndOutsideCoordinates() {
        ByteBuffer d=ByteBuffer.allocate(8),c=ByteBuffer.allocate(4);
        assertThrows(IllegalArgumentException.class,()->new DepthPixels(d,c,2,2,3,2,2,1));
        assertThrows(IllegalArgumentException.class,()->new DepthPixels(d,c,2,3,4,2,2,1));
        assertThrows(IllegalArgumentException.class,()->new DepthPixels(d,c,2,2,4,1,2,1));
        assertThrows(IllegalArgumentException.class,()->new DepthPixels(d,c,2049,2,Integer.MAX_VALUE,Integer.MAX_VALUE,2,1));
        DepthPixels image=new DepthPixels(d,c,2,2,4,2,2,1);assertThrows(IllegalArgumentException.class,()->image.millimetres(2,0));
    }
    @Test public void centralSamplingRequiresBothRangeAndConfidence() {
        ByteBuffer d=ByteBuffer.allocate(12*12*2),c=ByteBuffer.allocate(12*12);
        for(int i=0;i<144;i++){d.put(i*2,(byte)0xe8);d.put(i*2+1,(byte)3);c.put(i,(byte)204);}
        DepthPixels image=new DepthPixels(d,c,12,12,24,2,12,1);assertArrayEquals(new int[]{4,4},image.centralSample());
        c.put(3+3*12,(byte)203);d.put((6+3*12)*2,(byte)0);d.put((6+3*12)*2+1,(byte)0);
        assertArrayEquals(new int[]{4,2},image.centralSample());
        c.put(0,(byte)0);assertArrayEquals(new int[]{4,2},image.centralSample());
    }
}
