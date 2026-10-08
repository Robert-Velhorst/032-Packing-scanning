package com.packingscanning.app.scanning;

import java.nio.ByteBuffer;

/** Nearest-neighbour samples from three YUV_420_888 planes, with ARCore-mapped corners.
 * Coordinates are top-left, top-right, bottom-left of the square shown in the view.
 * Positions/limits and each plane's independent row/pixel strides are respected. */
public final class YuvRgbInput {
    private YuvRgbInput(){}
    public static byte[] sample(ByteBuffer[] planes,int[] rows,int[] strides,int width,int height,float[] corners,int size){
        if(planes==null||rows==null||strides==null||planes.length!=3||rows.length!=3||strides.length!=3||width<2||height<2||size<1||size>320||corners==null||corners.length!=6)throw new IllegalArgumentException("Invalid camera image.");
        for(int i=0;i<3;i++)if(planes[i]==null||rows[i]<1||strides[i]<1)throw new IllegalArgumentException("Invalid camera plane.");
        for(float c:corners)if(!Float.isFinite(c))throw new IllegalArgumentException("Invalid view mapping.");
        byte[] rgb=new byte[size*size*3];int offset=0;
        try{
            for(int y=0;y<size;y++)for(int x=0;x<size;x++){
                float fx=(x+0.5f)/size,fy=(y+0.5f)/size;
                int ix=(int)Math.floor(corners[0]+fx*(corners[2]-corners[0])+fy*(corners[4]-corners[0]));
                int iy=(int)Math.floor(corners[1]+fx*(corners[3]-corners[1])+fy*(corners[5]-corners[1]));
                if(ix<0||ix>=width||iy<0||iy>=height)throw new IllegalArgumentException("Camera view mapping is outside the image.");
                int yy=read(planes[0],rows[0],strides[0],ix,iy)-16;
                int u=read(planes[1],rows[1],strides[1],ix/2,iy/2)-128,v=read(planes[2],rows[2],strides[2],ix/2,iy/2)-128;
                int c=298*Math.max(0,yy);
                rgb[offset++]=clamp((c+409*v+128)>>8);rgb[offset++]=clamp((c-100*u-208*v+128)>>8);rgb[offset++]=clamp((c+516*u+128)>>8);
            }
            return rgb;
        }catch(RuntimeException error){java.util.Arrays.fill(rgb,(byte)0);throw error;}
    }
    private static int read(ByteBuffer b,int row,int stride,int x,int y){long offset=(long)b.position()+(long)y*row+(long)x*stride;if(offset<b.position()||offset>=b.limit())throw new IllegalArgumentException("Truncated camera plane.");return b.get((int)offset)&255;}
    private static byte clamp(int v){return (byte)Math.max(0,Math.min(255,v));}
}
