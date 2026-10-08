package com.packingscanning.app.scanning;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

/** Diagnostics of sampled pixels and camera directions, never object completeness or accuracy. */
public final class CaptureGuidance {
    public static final String METHOD = "camera_depth_guidance_v1";
    private static final int MAX_FRAMES = 100000;
    private final ArrayDeque<int[]> recent = new ArrayDeque<>();
    private long lastTimestamp = -1;
    private int frames, examined, confident, sideMask, elevated, lowered;

    public synchronized void depth(long timestamp, int sampled, int reliable) {
        if (timestamp <= lastTimestamp || timestamp < 0) return;
        if (sampled < 1 || sampled > 500000 || reliable < 0 || reliable > sampled) throw new IllegalArgumentException("Invalid depth diagnostics.");
        lastTimestamp = timestamp;
        if (frames >= MAX_FRAMES || examined > Integer.MAX_VALUE - sampled) return;
        frames++; examined += sampled; confident += reliable;
        recent.addLast(new int[]{sampled,reliable});
        if (recent.size() > 8) recent.removeFirst();
    }

    /** Called only for a new, separated direction that contributed enough retained depth points. */
    public synchronized void direction(float[] direction) {
        if (direction == null || direction.length != 3) return;
        double x=direction[0],y=direction[1],z=direction[2],norm=Math.sqrt(x*x+y*y+z*z);
        if (!Double.isFinite(norm) || norm < .05) return;
        double horizontal=Math.hypot(x,z);
        if (horizontal > norm*.25) {
            int sector=(int)Math.floor((Math.atan2(x,z)+Math.PI/4+Math.PI*2)/(Math.PI/2))%4;
            sideMask |= 1 << sector;
        }
        double elevation=Math.atan2(y,horizontal);
        if (elevation >= Math.toRadians(20)) elevated=Math.min(MAX_FRAMES,elevated+1);
        if (elevation <= -Math.toRadians(20)) lowered=Math.min(MAX_FRAMES,lowered+1);
    }

    public synchronized Summary summary() { return new Summary(frames,examined,confident,sideMask,elevated,lowered); }

    public synchronized String hint(boolean item) {
        int pixels=0,valid=0;
        for(int[] frame:recent){pixels+=frame[0];valid+=frame[1];}
        if (recent.size() >= 3 && valid < pixels*.10) return "Little high-confidence depth in the centre. Move slowly, improve the light or change the viewing angle. Shiny, transparent or plain surfaces may need manual measurement.";
        if (!item) return "Look down into the empty bag from different directions and heights. Hidden walls and pockets still need manual review.";
        int[] order={2,1,3,0}; String[] names={"the starting side","one side","the opposite side","the other side"};
        for(int sector:order) if((sideMask & (1<<sector))==0) return "Try "+names[sector]+" of the object if safely reachable. Camera directions do not prove that a surface was captured.";
        if(elevated==0) return "Try a higher viewpoint while keeping the object still. Check hidden surfaces separately.";
        if(lowered==0) return "Try a lower viewpoint if safely reachable. Do not move the object during this capture; its underside may still be missing.";
        return "Several camera directions contributed points. Inspect missing surfaces and neighbouring objects; this is not complete-coverage proof.";
    }

    public static final class Summary {
        public final int freshFrames, examinedPixels, confidentPixels, sideMask, elevatedViews, loweredViews;
        private Summary(int frames,int pixels,int reliable,int sides,int elevated,int lowered) {
            freshFrames=frames;examinedPixels=pixels;confidentPixels=reliable;sideMask=sides;elevatedViews=elevated;loweredViews=lowered;
        }
        public List<String> warnings(boolean item) {
            List<String> result=new ArrayList<>();
            if(freshFrames>0 && confidentPixels < examinedPixels*.10) result.add("Few central sampled pixels supplied high-confidence depth. This is a sampled-image diagnostic, not a measurement of object coverage or accuracy. Check missing geometry or use manual dimensions.");
            if(item && sideMask != 15) result.add("Not all four camera-side sectors contributed retained depth points. Rescan the missing sides if reachable; hidden surfaces can remain missing even with all sectors.");
            if(item && (elevatedViews==0 || loweredViews==0)) result.add("Higher or lower camera viewpoints are missing. Keep the object still, inspect its hidden surfaces and measure them separately if needed.");
            return result;
        }
    }
}
