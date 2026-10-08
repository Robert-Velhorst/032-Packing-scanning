package com.packingscanning.app.scanning;

import android.content.res.AssetManager;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;
import org.tensorflow.lite.DataType;
import org.tensorflow.lite.Interpreter;

/** Bundled CPU-only model. No network, file writes, telemetry, or retained frame. */
public final class LocalItemDetector {
    public static final int SIZE=320,MODEL_BYTES=4563519;
    private LocalItemDetector(){}
    public static JSONObject detect(AssetManager assets,byte[] rgb) throws Exception {
        ByteBuffer model=null,input=null;float[][][] boxes=new float[1][25][4];float[][] classes=new float[1][25],scores=new float[1][25];float[] count=new float[1];
        try{
            if(rgb==null||rgb.length!=SIZE*SIZE*3)throw new IllegalArgumentException("Invalid recognition image.");
            model=ByteBuffer.allocateDirect(MODEL_BYTES).order(ByteOrder.nativeOrder());MessageDigest hash=MessageDigest.getInstance("SHA-256");
            try(InputStream in=assets.open("recognition/efficientdet-lite0.tflite")){
                byte[] chunk=new byte[8192];int n;
                try{while((n=in.read(chunk))!=-1){if(n>model.remaining())throw new IllegalArgumentException("Invalid recognition model length.");hash.update(chunk,0,n);model.put(chunk,0,n);}}
                finally{Arrays.fill(chunk,(byte)0);}
            }
            StringBuilder hex=new StringBuilder();for(byte b:hash.digest())hex.append(String.format(java.util.Locale.US,"%02x",b&255));
            if(model.position()!=MODEL_BYTES||!RecognitionPolicy.HASH.equals(hex.toString()))throw new IllegalArgumentException("Recognition model integrity check failed.");
            model.rewind();input=ByteBuffer.allocateDirect(rgb.length).order(ByteOrder.nativeOrder());input.put(rgb).rewind();
            try(Interpreter interpreter=new Interpreter(model,new Interpreter.Options().setNumThreads(2))){
                interpreter.allocateTensors();
                if(interpreter.getInputTensorCount()!=1||interpreter.getOutputTensorCount()!=4||interpreter.getInputTensor(0).dataType()!=DataType.UINT8||!Arrays.equals(interpreter.getInputTensor(0).shape(),new int[]{1,SIZE,SIZE,3}))throw new IllegalArgumentException("Unsupported recognition input.");
                int[][] shapes={{1,25,4},{1,25},{1,25},{1}};
                for(int i=0;i<4;i++)if(interpreter.getOutputTensor(i).dataType()!=DataType.FLOAT32||!Arrays.equals(interpreter.getOutputTensor(i).shape(),shapes[i]))throw new IllegalArgumentException("Unsupported recognition output.");
                Map<Integer,Object> outputs=new HashMap<>();outputs.put(0,boxes);outputs.put(1,classes);outputs.put(2,scores);outputs.put(3,count);
                interpreter.runForMultipleInputsOutputs(new Object[]{input},outputs);
                return RecognitionPolicy.select(boxes[0],classes[0],scores[0],count[0]);
            }
        }finally{
            if(rgb!=null)Arrays.fill(rgb,(byte)0);wipe(input);wipe(model);
            for(float[] b:boxes[0])Arrays.fill(b,0);Arrays.fill(classes[0],0);Arrays.fill(scores[0],0);Arrays.fill(count,0);
        }
    }
    private static void wipe(ByteBuffer b){if(b!=null){b.clear();while(b.hasRemaining())b.put((byte)0);}}
}
