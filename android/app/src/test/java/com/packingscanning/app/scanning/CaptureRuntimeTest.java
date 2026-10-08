package com.packingscanning.app.scanning;

import org.junit.Before;
import org.junit.After;
import org.junit.ClassRule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.IOException;
import java.util.UUID;
import static org.junit.Assert.*;

public class CaptureRuntimeTest {
    @ClassRule public static TemporaryFolder temporary=new TemporaryFolder();
    private CaptureScopeManager manager;
    @Before public void prepare()throws Exception{manager=CaptureRuntime.manager(temporary.getRoot());manager.lock();}
    @After public void finish(){manager.lock();}
    private CaptureScopeManager.Access open()throws Exception{return manager.openWorkspace(manager.revision(),UUID.randomUUID().toString(),UUID.randomUUID().toString(),new byte[32]);}
    @Test public void onlyAnActuallyEnteredAndLiveCaptureCanKeepItsLeaseDuringTheOwnedTransition()throws Exception{
        CaptureScopeManager.Access access=open();assertFalse(CaptureRuntime.hasForegroundCapture(access.lease()));
        CaptureRuntime.enterCapture(access);assertTrue(CaptureRuntime.hasForegroundCapture(access.lease()));assertFalse(CaptureRuntime.hasForegroundCapture(UUID.randomUUID().toString()));
        CaptureRuntime.leaveCapture(access);assertFalse(CaptureRuntime.hasForegroundCapture(access.lease()));
    }
    @Test public void lockedOrSwitchedScopesCannotBeKeptOpenByAnOldForegroundMarker()throws Exception{
        CaptureScopeManager.Access first=open();CaptureRuntime.enterCapture(first);manager.lock();assertFalse(CaptureRuntime.hasForegroundCapture(first.lease()));
        CaptureScopeManager.Access second=open();assertFalse(CaptureRuntime.hasForegroundCapture(second.lease()));CaptureRuntime.enterCapture(second);
        CaptureRuntime.leaveCapture(first);assertTrue(CaptureRuntime.hasForegroundCapture(second.lease()));assertThrows(IOException.class,()->CaptureRuntime.enterCapture(first));
    }
    @Test public void aDifferentAppRootCannotReuseTheProcessAuthority()throws Exception{
        assertThrows(IOException.class,()->CaptureRuntime.manager(temporary.newFolder()));
    }
}
