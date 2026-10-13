package com.packingscanning.app.files;
import java.io.IOException;
public final class ReferenceCameraPolicy {
    private ReferenceCameraPolicy(){}
    public static int chooseSize(int[][] sizes)throws IOException{
        int best=-1,fallback=-1;long bestArea=-1,fallbackArea=Long.MAX_VALUE;
        for(int i=0;i<sizes.length;i++){int w=sizes[i][0],h=sizes[i][1];long area=(long)w*h;if(w<=0||h<=0||Math.max(w,h)>4096||area>16_000_000L)continue;
            if(Math.max(w,h)<=2048&&area>bestArea){best=i;bestArea=area;}if(area<fallbackArea){fallback=i;fallbackArea=area;}}
        if(best>=0)return best;if(fallback>=0)return fallback;throw new IOException("This camera has no bounded reference-photo output. Choose an existing photo instead.");
    }
    public static float[] previewScale(int bufferWidth,int bufferHeight,int viewWidth,int viewHeight,int sensor,int display){
        if(bufferWidth<=0||bufferHeight<=0||viewWidth<=0||viewHeight<=0)throw new IllegalArgumentException("Invalid preview size.");
        float naturalWidth=sensor%180==0?bufferWidth:bufferHeight,naturalHeight=sensor%180==0?bufferHeight:bufferWidth;
        float rotatedWidth=display%180==0?naturalWidth:naturalHeight,rotatedHeight=display%180==0?naturalHeight:naturalWidth;
        float fit=Math.min(viewWidth/rotatedWidth,viewHeight/rotatedHeight);
        return new float[]{naturalWidth/viewWidth*fit,naturalHeight/viewHeight*fit};
    }
    public static int jpegOrientation(int sensor,int displayDegrees,boolean front){return ((sensor+(front?displayDegrees:-displayDegrees))%360+360)%360;}
}
