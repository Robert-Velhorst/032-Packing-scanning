package com.packingscanning.app.scanning;

import java.nio.ByteBuffer;

/** Bounded reads relative to the plane's position/limit, including padded and interleaved rows. */
public final class DepthPixels {
    private final ByteBuffer depth,confidence;
    private final int width,height,depthRow,depthPixel,confidenceRow,confidencePixel;
    public DepthPixels(ByteBuffer depth,ByteBuffer confidence,int width,int height,int depthRow,int depthPixel,int confidenceRow,int confidencePixel) {
        if(depth==null||confidence==null||width<1||height<1||width>2048||height>2048||depthPixel<2||confidencePixel<1
            ||depthRow<(long)(width-1)*depthPixel+2||confidenceRow<(long)(width-1)*confidencePixel+1
            ||(long)(height-1)*depthRow+(long)(width-1)*depthPixel+2>depth.remaining()
            ||(long)(height-1)*confidenceRow+(long)(width-1)*confidencePixel+1>confidence.remaining()) throw new IllegalArgumentException("Unsupported depth plane layout.");
        this.depth=depth.asReadOnlyBuffer();this.confidence=confidence.asReadOnlyBuffer();this.width=width;this.height=height;
        this.depthRow=depthRow;this.depthPixel=depthPixel;this.confidenceRow=confidenceRow;this.confidencePixel=confidencePixel;
    }
    private void check(int x,int y){if(x<0||y<0||x>=width||y>=height)throw new IllegalArgumentException("Depth pixel outside image.");}
    public int millimetres(int x,int y){check(x,y);int i=depth.position()+y*depthRow+x*depthPixel;return Byte.toUnsignedInt(depth.get(i)) | Byte.toUnsignedInt(depth.get(i+1))<<8;}
    public int confidence(int x,int y){check(x,y);return Byte.toUnsignedInt(confidence.get(confidence.position()+y*confidenceRow+x*confidencePixel));}
    public int[] centralSample(){int sampled=0,reliable=0;for(int y=height/4;y<height-height/4;y+=3)for(int x=width/4;x<width-width/4;x+=3){sampled++;int mm=millimetres(x,y);if(mm>=150&&mm<=4000&&confidence(x,y)>=204)reliable++;}return new int[]{sampled,reliable};}
}
