package com.packingscanning.app.scanning;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.JSONObject;

public class RecognitionPolicyTest {
    @Test public void agreesWithActualCpuModelFixtureOutputs() throws Exception {
        java.io.InputStream in=getClass().getResourceAsStream("/recognition-outputs.json");assertNotNull(in);
        java.io.ByteArrayOutputStream buffer=new java.io.ByteArrayOutputStream();byte[] chunk=new byte[2048];int n;
        try{while((n=in.read(chunk))!=-1)buffer.write(chunk,0,n);}finally{in.close();}
        JSONObject report=new JSONObject(new String(buffer.toByteArray(),java.nio.charset.StandardCharsets.UTF_8));assertEquals(RecognitionPolicy.HASH,report.getString("modelSha256"));
        org.json.JSONArray fixtures=report.getJSONArray("fixtures");
        for(int f=0;f<fixtures.length();f++){
            JSONObject fixture=fixtures.getJSONObject(f);float[][] boxes=new float[25][4];float[] classes=new float[25],scores=new float[25];
            for(int i=0;i<25;i++){classes[i]=(float)fixture.getJSONArray("classes").getDouble(i);scores[i]=(float)fixture.getJSONArray("scores").getDouble(i);for(int j=0;j<4;j++)boxes[i][j]=(float)fixture.getJSONArray("boxes").getJSONArray(i).getDouble(j);}
            org.json.JSONArray actual=RecognitionPolicy.select(boxes,classes,scores,(float)fixture.getDouble("count")).getJSONArray("candidates"),expected=fixture.getJSONArray("candidates");
            assertEquals(fixture.getString("name"),expected.length(),actual.length());
            for(int i=0;i<actual.length();i++){assertEquals(expected.getJSONObject(i).getInt("classId"),actual.getJSONObject(i).getInt("classId"));assertEquals(expected.getJSONObject(i).getDouble("score"),actual.getJSONObject(i).getDouble("score"),0.000001);}
        }
    }
    private float[][] boxes(){float[][] b=new float[25][4];for(float[] v:b){v[0]=0.1f;v[1]=0.1f;v[2]=0.9f;v[3]=0.9f;}return b;}
    @Test public void selectsOnlySupportedCentralLabelsAndDeduplicatesInScoreOrder() throws Exception {
        float[] labels=new float[25],scores=new float[25];labels[0]=72;labels[1]=76;labels[2]=72;labels[3]=17;scores[0]=0.7f;scores[1]=0.8f;scores[2]=0.9f;scores[3]=0.99f;
        JSONObject r=RecognitionPolicy.select(boxes(),labels,scores,4);
        assertEquals(2,r.getJSONArray("candidates").length());assertEquals(72,r.getJSONArray("candidates").getJSONObject(0).getInt("classId"));assertEquals(76,r.getJSONArray("candidates").getJSONObject(1).getInt("classId"));
        assertFalse(r.has("dimensions"));assertFalse(r.has("weight"));
    }
    @Test public void rejectsPeripheralSmallAndWeakLabels() throws Exception {
        float[][] b=boxes();float[] labels=new float[25],scores=new float[25];labels[0]=labels[1]=labels[2]=72;scores[0]=0.54f;scores[1]=scores[2]=0.9f;
        b[1]=new float[]{0,0,0.2f,0.2f};b[2]=new float[]{0.49f,0.49f,0.51f,0.51f};
        assertEquals(0,RecognitionPolicy.select(b,labels,scores,3).getJSONArray("candidates").length());
    }
    @Test public void capsThreeDifferentLabels() throws Exception {
        float[] labels=new float[25],scores=new float[25];for(int i=0;i<4;i++){labels[i]=26+i;scores[i]=0.8f;}labels[2]=30;labels[3]=31;
        assertEquals(3,RecognitionPolicy.select(boxes(),labels,scores,4).getJSONArray("candidates").length());
    }
    @Test public void noDetectionIsCompleteAndUnavailableHasNoCandidates() throws Exception {
        assertEquals("complete",RecognitionPolicy.select(boxes(),new float[25],new float[25],0).getString("status"));assertEquals(0,RecognitionPolicy.unavailable().getJSONArray("candidates").length());
    }
    @Test public void malformedCountLabelScoreAndCoordinatesFailClosed() throws Exception {
        for(float value:new float[]{Float.NaN,Float.POSITIVE_INFINITY,-1,26,1.5f})try{RecognitionPolicy.select(boxes(),new float[25],new float[25],value);fail();}catch(IllegalArgumentException expected){}
        float[] labels=new float[25],scores=new float[25];labels[0]=72;scores[0]=Float.NaN;
        try{RecognitionPolicy.select(boxes(),labels,scores,1);fail();}catch(IllegalArgumentException expected){}
        scores[0]=0.8f;labels[0]=72.5f;try{RecognitionPolicy.select(boxes(),labels,scores,1);fail();}catch(IllegalArgumentException expected){}
        labels[0]=72;float[][] b=boxes();b[0][0]=Float.NaN;try{RecognitionPolicy.select(b,labels,scores,1);fail();}catch(IllegalArgumentException expected){}
    }
}
