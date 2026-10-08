package com.packingscanning.app.scanning;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Scores are model outputs, not calibrated accuracy, size, or handling evidence. */
public final class RecognitionPolicy {
    public static final String MODEL="efficientdet_lite0_metadata_v1";
    public static final String HASH="2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b";
    private static final Set<Integer> ALLOWED=new HashSet<>(Arrays.asList(26,27,30,31,32,33,34,35,36,37,38,39,40,41,42,43,46,47,48,49,50,72,73,74,75,76,83,86,87,88,89));
    private RecognitionPolicy(){}
    public static JSONObject unavailable() throws Exception {return reply("unavailable",new JSONArray());}
    private static JSONObject reply(String status,JSONArray candidates) throws Exception {
        return new JSONObject().put("version",1).put("model",MODEL).put("modelSha256",HASH).put("source","camera_center_square").put("status",status).put("candidates",candidates);
    }
    public static JSONObject select(float[][] boxes,float[] classes,float[] scores,float count) throws Exception {
        if(!Float.isFinite(count)||count!=(int)count||count<0||count>25||boxes.length!=25||classes.length!=25||scores.length!=25)throw new IllegalArgumentException("Invalid detection output.");
        List<Integer> selected=new ArrayList<>();
        for(int i=0;i<(int)count;i++){
            float[] b=boxes[i];float score=scores[i],label=classes[i];
            if(b==null||b.length!=4||!Float.isFinite(score)||score<0||score>1||!Float.isFinite(label)||label!=(int)label||label<0||label>=90)throw new IllegalArgumentException("Invalid detection output.");
            for(float v:b)if(!Float.isFinite(v))throw new IllegalArgumentException("Invalid detection box.");
            // Model boxes may extend a little beyond the image. Do not turn them into metric bounds.
            if(b[2]<=b[0]||b[3]<=b[1])continue;
            if(score<0.55f||!ALLOWED.contains((int)label)||b[0]>0.5f||b[2]<0.5f||b[1]>0.5f||b[3]<0.5f)continue;
            float area=(Math.min(1,b[2])-Math.max(0,b[0]))*(Math.min(1,b[3])-Math.max(0,b[1]));
            if(area>=0.03f)selected.add(i);
        }
        selected.sort(Comparator.<Integer>comparingDouble(i->scores[i]).reversed().thenComparingInt(i->(int)classes[i]));
        JSONArray result=new JSONArray();Set<Integer> seen=new HashSet<>();
        for(int i:selected)if(seen.add((int)classes[i])){result.put(new JSONObject().put("classId",(int)classes[i]).put("score",scores[i]));if(result.length()==3)break;}
        return reply("complete",result);
    }
}
