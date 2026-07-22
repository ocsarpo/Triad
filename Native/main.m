#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <Security/Security.h>
#import <UserNotifications/UserNotifications.h>
#import <sqlite3.h>

static NSString *const kKeychainService = @"kr.co.ocsarpo.triadroom";

@interface AppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, UNUserNotificationCenterDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSTask *> *tasks;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSTask *> *authTasks;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSTask *> *brokerEventTasks;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *brokerArtifacts;
@property(nonatomic, strong) NSTask *usageTask;
@property(nonatomic) sqlite3 *database;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.tasks = [NSMutableDictionary dictionary];
    self.authTasks = [NSMutableDictionary dictionary];
    self.brokerEventTasks = [NSMutableDictionary dictionary];
    self.brokerArtifacts = [NSMutableDictionary dictionary];
    NSString *iconPath = [[NSBundle mainBundle] pathForResource:@"Triad" ofType:@"icns"];
    NSImage *applicationIcon = iconPath ? [[NSImage alloc] initWithContentsOfFile:iconPath] : nil;
    if (applicationIcon) [NSApp setApplicationIconImage:applicationIcon];
    UNUserNotificationCenter *notificationCenter = UNUserNotificationCenter.currentNotificationCenter;
    notificationCenter.delegate = self;
    [notificationCenter requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound)
                                      completionHandler:^(BOOL granted, NSError *error) {}];
    [self setupDatabase];
    [self setupMainMenu];

    WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
    [configuration.userContentController addScriptMessageHandler:self name:@"triad"];

    self.webView = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 1650, 820)
                                      configuration:configuration];
    self.webView.navigationDelegate = self;

    self.window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, 1650, 820)
                  styleMask:NSWindowStyleMaskTitled |
                            NSWindowStyleMaskClosable |
                            NSWindowStyleMaskMiniaturizable |
                            NSWindowStyleMaskResizable
                    backing:NSBackingStoreBuffered
                      defer:NO];
    self.window.title = @"Triad";
    self.window.minSize = NSMakeSize(960, 620);
    self.window.delegate = self;
    self.window.contentView = self.webView;
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];

    NSURL *resourceURL = [[NSBundle mainBundle] resourceURL];
    NSURL *htmlURL = [resourceURL URLByAppendingPathComponent:@"index.html"];
    [self.webView loadFileURL:htmlURL allowingReadAccessToURL:resourceURL];
    [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return NO;
}

- (BOOL)windowShouldClose:(NSWindow *)sender {
    [sender orderOut:nil];
    return NO;
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)hasVisibleWindows {
    if (!hasVisibleWindows) {
        [self.window makeKeyAndOrderFront:nil];
        [NSApp activateIgnoringOtherApps:YES];
    }
    return YES;
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler {
    completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionSound);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
         withCompletionHandler:(void (^)(void))completionHandler {
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.window makeKeyAndOrderFront:nil];
        [NSApp activateIgnoringOtherApps:YES];
    });
    completionHandler();
}

- (void)notifyAgentCompletion:(NSString *)agent exitCode:(int)exitCode {
    if (self.window.isVisible && NSApp.isActive) return;
    NSString *name = [agent isEqualToString:@"codex"] ? @"Codex" : @"Claude";
    UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
    content.title = [NSString stringWithFormat:@"Triad · %@ 작업 완료", name];
    content.body = exitCode == 0 ? @"응답이 준비되었습니다. 눌러서 대화를 확인하세요."
                                 : [NSString stringWithFormat:@"작업이 종료되었습니다. (코드 %d)", exitCode];
    content.sound = UNNotificationSound.defaultSound;
    NSString *identifier = [NSString stringWithFormat:@"triad-%@-%@", agent, NSUUID.UUID.UUIDString];
    UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:identifier content:content trigger:nil];
    [UNUserNotificationCenter.currentNotificationCenter addNotificationRequest:request withCompletionHandler:nil];
}

- (void)setupMainMenu {
    NSMenu *mainMenu = [[NSMenu alloc] initWithTitle:@""];
    NSMenuItem *applicationItem = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
    [mainMenu addItem:applicationItem];
    NSMenu *applicationMenu = [[NSMenu alloc] initWithTitle:@"Triad"];
    [applicationMenu addItemWithTitle:@"Triad 종료" action:@selector(terminate:) keyEquivalent:@"q"];
    applicationItem.submenu = applicationMenu;

    NSMenuItem *editItem = [[NSMenuItem alloc] initWithTitle:@"편집" action:nil keyEquivalent:@""];
    [mainMenu addItem:editItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"편집"];
    [editMenu addItemWithTitle:@"복사" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"붙여넣기" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"전체 선택" action:@selector(selectAll:) keyEquivalent:@"a"];
    editItem.submenu = editMenu;
    NSApp.mainMenu = mainMenu;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    for (NSTask *task in self.tasks.allValues) {
        if (task.isRunning) [task interrupt];
    }
    for (NSTask *task in self.authTasks.allValues) {
        if (task.isRunning) [task interrupt];
    }
    for (NSTask *task in self.brokerEventTasks.allValues) {
        if (task.isRunning) [task terminate];
    }
    if (self.usageTask.isRunning) [self.usageTask terminate];
    if (self.database) sqlite3_close(self.database);
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    NSString *home = NSHomeDirectory();
    NSString *codexPath = [self firstExecutable:@[
        @"/Applications/ChatGPT.app/Contents/Resources/codex",
        [home stringByAppendingPathComponent:@".local/bin/codex"],
        @"/opt/homebrew/bin/codex",
        @"/usr/local/bin/codex"
    ]] ?: @"codex";
    NSString *claudePath = [self firstExecutable:@[
        [home stringByAppendingPathComponent:@".local/bin/claude"],
        @"/opt/homebrew/bin/claude",
        @"/usr/local/bin/claude"
    ]] ?: @"claude";
    NSDictionary *payload = @{
        @"type": @"boot",
        @"home": home,
        @"codexPath": codexPath,
        @"claudePath": claudePath,
        @"codexModels": [self codexModelCatalog],
        @"claudeModels": [self claudeModelCatalogForExecutable:claudePath],
        @"conversations": [self loadConversations],
        @"tokenStatus": @{
            @"codex": @([self tokenForAgent:@"codex"] != nil),
            @"claude": @([self tokenForAgent:@"claude"] != nil)
        }
    };
    [self emit:payload];
}

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:[NSDictionary class]]) return;
    NSDictionary *body = (NSDictionary *)message.body;
    NSString *action = body[@"action"];
    if ([action isEqualToString:@"run"]) {
        [self runAgent:body];
    } else if ([action isEqualToString:@"stop"]) {
        [self stopAgent:body[@"agent"]];
    } else if ([action isEqualToString:@"chooseDirectory"]) {
        [self chooseDirectoryForAgent:body[@"agent"]];
    } else if ([action isEqualToString:@"chooseFiles"]) {
        [self chooseFilesFromWorkspace:body[@"workspace"]];
    } else if ([action isEqualToString:@"saveToken"]) {
        [self saveToken:body[@"token"] forAgent:body[@"agent"]];
    } else if ([action isEqualToString:@"deleteToken"]) {
        [self deleteTokenForAgent:body[@"agent"]];
    } else if ([action isEqualToString:@"tokenStatus"]) {
        [self emitTokenStatus];
    } else if ([action isEqualToString:@"saveConversation"]) {
        [self saveConversation:body[@"conversation"]];
    } else if ([action isEqualToString:@"deleteConversation"]) {
        [self deleteConversation:body[@"id"]];
    } else if ([action isEqualToString:@"openURL"]) {
        [self openExternalURL:body[@"url"]];
    } else if ([action isEqualToString:@"refreshUsage"]) {
        [self refreshCodexUsage:body[@"config"]];
    } else if ([action isEqualToString:@"authAccount"]) {
        [self runAuthOperation:body[@"operation"] agent:body[@"agent"] config:body[@"config"]];
    } else if ([action isEqualToString:@"projectDiff"]) {
        [self loadProjectDiff:body[@"workspace"] agent:body[@"agent"]];
    } else if ([action isEqualToString:@"gitBranch"]) {
        [self loadGitBranch:body[@"workspace"] agent:body[@"agent"]];
    } else if ([action isEqualToString:@"projectFiles"]) {
        [self loadProjectFiles:body[@"workspace"] agent:body[@"agent"]];
    } else if ([action isEqualToString:@"checkUpdate"]) {
        [self checkForUpdates];
    }
}

- (void)checkForUpdates {
    NSURL *url = [NSURL URLWithString:@"https://api.github.com/repos/ocsarpo/Triad/releases/latest"];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:12];
    [request setValue:@"Triad-macOS-update-check" forHTTPHeaderField:@"User-Agent"];
    [[[NSURLSession sharedSession] dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        if (error || !data.length || [(NSHTTPURLResponse *)response statusCode] != 200) return;
        NSDictionary *release = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        NSString *tag = [release[@"tag_name"] isKindOfClass:[NSString class]] ? release[@"tag_name"] : @"";
        NSString *page = [release[@"html_url"] isKindOfClass:[NSString class]] ? release[@"html_url"] : @"";
        if (!tag.length || !page.length) return;
        NSString *current = [NSBundle mainBundle].infoDictionary[@"CFBundleShortVersionString"] ?: @"0.0.0";
        dispatch_async(dispatch_get_main_queue(), ^{ [self emit:@{ @"type": @"updateCheck", @"latest": tag, @"current": current, @"url": page }]; });
    }] resume];
}

- (void)loadProjectFiles:(NSString *)workspace agent:(NSString *)agent {
    if (![workspace isKindOfClass:[NSString class]] || workspace.length == 0 || ![agent isKindOfClass:[NSString class]]) return;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        NSFileManager *manager = NSFileManager.defaultManager;
        BOOL isDirectory = NO;
        if (![manager fileExistsAtPath:workspace isDirectory:&isDirectory] || !isDirectory) {
            dispatch_async(dispatch_get_main_queue(), ^{ [self emit:@{ @"type": @"projectFiles", @"agent": agent, @"workspace": workspace, @"files": @[], @"error": @"작업 폴더를 찾을 수 없습니다." }]; });
            return;
        }
        NSMutableArray *files = [NSMutableArray array];
        NSDictionary *rootResult = [self runGit:@[@"rev-parse", @"--show-toplevel"] workspace:workspace];
        NSString *root = [rootResult[@"output"] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        BOOL gitRepository = [rootResult[@"code"] intValue] == 0 && root.length > 0;
        BOOL truncated = NO;
        if (gitRepository) {
            NSDictionary *listed = [self runGit:@[@"ls-files", @"--cached", @"--others", @"--exclude-standard"] workspace:root];
            NSDictionary *changed = [self runGit:@[@"diff", @"--name-only", @"HEAD", @"--", @"."] workspace:root];
            NSDictionary *untracked = [self runGit:@[@"ls-files", @"--others", @"--exclude-standard"] workspace:root];
            NSSet *changedPaths = [NSSet setWithArray:[changed[@"output"] componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]];
            NSSet *untrackedPaths = [NSSet setWithArray:[untracked[@"output"] componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]];
            for (NSString *path in [listed[@"output"] componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]) {
                if (path.length == 0) continue;
                NSString *status = [untrackedPaths containsObject:path] ? @"U" : ([changedPaths containsObject:path] ? @"M" : @"");
                [files addObject:@{ @"path": path, @"status": status }];
                if (files.count >= 20000) { truncated = YES; break; }
            }
        } else {
            root = workspace;
            NSSet *excluded = [NSSet setWithArray:@[@".git", @".gradle", @"node_modules", @"build", @"dist", @"out", @"target", @"vendor"]];
            NSDirectoryEnumerator<NSURL *> *enumerator = [manager enumeratorAtURL:[NSURL fileURLWithPath:root isDirectory:YES]
                                                       includingPropertiesForKeys:@[NSURLIsDirectoryKey, NSURLIsRegularFileKey]
                                                                          options:NSDirectoryEnumerationSkipsHiddenFiles
                                                                     errorHandler:^BOOL(NSURL *url, NSError *error) { return YES; }];
            for (NSURL *url in enumerator) {
                NSNumber *directory = nil; [url getResourceValue:&directory forKey:NSURLIsDirectoryKey error:nil];
                if (directory.boolValue && [excluded containsObject:url.lastPathComponent]) { [enumerator skipDescendants]; continue; }
                NSNumber *regular = nil; [url getResourceValue:&regular forKey:NSURLIsRegularFileKey error:nil];
                if (!regular.boolValue) continue;
                NSString *path = url.path.length > root.length ? [url.path substringFromIndex:root.length + 1] : url.lastPathComponent;
                [files addObject:@{ @"path": path ?: @"", @"status": @"" }];
                if (files.count >= 20000) { truncated = YES; break; }
            }
        }
        dispatch_async(dispatch_get_main_queue(), ^{ [self emit:@{ @"type": @"projectFiles", @"agent": agent, @"workspace": root ?: workspace, @"files": files, @"truncated": @(truncated), @"error": @"" }]; });
    });
}

- (void)loadGitBranch:(NSString *)workspace agent:(NSString *)agent {
    if (![workspace isKindOfClass:[NSString class]] || workspace.length == 0 || ![agent isKindOfClass:[NSString class]]) return;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        NSDictionary *root = [self runGit:@[@"rev-parse", @"--show-toplevel"] workspace:workspace];
        if ([root[@"code"] intValue] != 0) {
            dispatch_async(dispatch_get_main_queue(), ^{ [self emit:@{ @"type": @"branchResult", @"agent": agent, @"workspace": workspace, @"kind": @"none", @"label": @"Git 저장소 아님" }]; });
            return;
        }
        NSDictionary *branch = [self runGit:@[@"branch", @"--show-current"] workspace:workspace];
        NSString *name = [branch[@"output"] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        NSString *kind = @"branch";
        if (name.length == 0) {
            NSDictionary *commit = [self runGit:@[@"rev-parse", @"--short", @"HEAD"] workspace:workspace];
            name = [commit[@"output"] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
            name = name.length ? [NSString stringWithFormat:@"detached · %@", name] : @"브랜치 확인 불가";
            kind = @"detached";
        }
        dispatch_async(dispatch_get_main_queue(), ^{ [self emit:@{ @"type": @"branchResult", @"agent": agent, @"workspace": workspace, @"kind": kind, @"label": name }]; });
    });
}

- (NSDictionary *)runGit:(NSArray<NSString *> *)arguments workspace:(NSString *)workspace {
    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:@"/usr/bin/git"];
    task.arguments = arguments;
    task.currentDirectoryURL = [NSURL fileURLWithPath:workspace isDirectory:YES];
    NSPipe *output = [NSPipe pipe];
    NSPipe *error = [NSPipe pipe];
    task.standardOutput = output;task.standardError = error;
    NSError *launchError = nil;
    if (![task launchAndReturnError:&launchError]) return @{ @"code": @(-1), @"output": @"", @"error": launchError.localizedDescription ?: @"Git 실행 실패" };
    NSData *data = [output.fileHandleForReading readDataToEndOfFile];
    NSData *errorData = [error.fileHandleForReading readDataToEndOfFile];
    [task waitUntilExit];
    return @{ @"code": @(task.terminationStatus),
              @"output": [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"",
              @"error": [[NSString alloc] initWithData:errorData encoding:NSUTF8StringEncoding] ?: @"" };
}

- (void)loadProjectDiff:(NSString *)workspace agent:(NSString *)agent {
    if (![workspace isKindOfClass:[NSString class]] || workspace.length == 0) return;
    NSString *sourceAgent = [agent isKindOfClass:[NSString class]] ? agent : @"codex";
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSDictionary *check = [self runGit:@[@"rev-parse", @"--is-inside-work-tree"] workspace:workspace];
        if ([check[@"code"] intValue] != 0) {
            dispatch_async(dispatch_get_main_queue(), ^{ [self emit:@{ @"type": @"diffResult", @"agent": sourceAgent, @"workspace": workspace, @"text": @"", @"error": @"선택한 작업 폴더가 Git 저장소가 아닙니다." }]; });
            return;
        }
        NSDictionary *tracked = [self runGit:@[@"diff", @"--no-ext-diff", @"--no-color", @"HEAD", @"--", @"."] workspace:workspace];
        if ([tracked[@"code"] intValue] != 0) tracked = [self runGit:@[@"diff", @"--no-ext-diff", @"--no-color", @"--", @"."] workspace:workspace];
        NSMutableString *diff = [NSMutableString stringWithString:tracked[@"output"] ?: @""];
        NSDictionary *untracked = [self runGit:@[@"ls-files", @"--others", @"--exclude-standard"] workspace:workspace];
        NSArray<NSString *> *paths = [untracked[@"output"] componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet];
        NSUInteger included = 0;BOOL truncated = NO;
        for (NSString *relative in paths) {
            if (relative.length == 0) continue;
            if (included >= 100 || diff.length > 2000000) { truncated = YES;break; }
            NSString *absolute = [workspace stringByAppendingPathComponent:relative];
            BOOL directory = NO;
            if (![[NSFileManager defaultManager] fileExistsAtPath:absolute isDirectory:&directory] || directory) continue;
            NSDictionary *attributes = [[NSFileManager defaultManager] attributesOfItemAtPath:absolute error:nil];
            unsigned long long size = [attributes fileSize];
            if (size > 524288) {
                [diff appendFormat:@"\ndiff --git a/%@ b/%@\nnew file mode 100644\nBinary or large file: %@ (%llu bytes)\n", relative, relative, relative, size];included++;continue;
            }
            NSData *fileData = [NSData dataWithContentsOfFile:absolute];
            NSString *content = [[NSString alloc] initWithData:fileData encoding:NSUTF8StringEncoding];
            if (!content) {
                [diff appendFormat:@"\ndiff --git a/%@ b/%@\nnew file mode 100644\nBinary file: %@\n", relative, relative, relative];included++;continue;
            }
            NSArray<NSString *> *lines = [content componentsSeparatedByString:@"\n"];
            NSUInteger lineCount = lines.count - ([content hasSuffix:@"\n"] ? 1 : 0);
            [diff appendFormat:@"\ndiff --git a/%@ b/%@\nnew file mode 100644\n--- /dev/null\n+++ b/%@\n@@ -0,0 +1,%lu @@\n", relative, relative, relative, (unsigned long)lineCount];
            for (NSUInteger index = 0; index < lineCount; index++) [diff appendFormat:@"+%@\n", lines[index]];
            included++;
        }
        if (diff.length > 2000000) { [diff deleteCharactersInRange:NSMakeRange(2000000, diff.length - 2000000)];truncated = YES; }
        dispatch_async(dispatch_get_main_queue(), ^{ [self emit:@{ @"type": @"diffResult", @"agent": sourceAgent, @"workspace": workspace, @"text": diff, @"truncated": @(truncated), @"error": @"" }]; });
    });
}

- (void)runAuthOperation:(NSString *)operation agent:(NSString *)agent config:(NSDictionary *)config {
    if (![operation isKindOfClass:[NSString class]] || ![agent isKindOfClass:[NSString class]] ||
        ![config isKindOfClass:[NSDictionary class]]) return;
    if (self.authTasks[agent].isRunning) return;
    NSString *executable = config[@"executablePath"];
    if (![[NSFileManager defaultManager] isExecutableFileAtPath:executable]) {
        [self emit:@{ @"type": @"authStatus", @"agent": agent, @"connected": @NO,
                      @"message": [NSString stringWithFormat:@"CLI 실행 파일을 찾을 수 없습니다: %@", executable ?: @""] }];
        return;
    }

    NSArray<NSString *> *arguments = nil;
    if ([agent isEqualToString:@"codex"]) {
        if ([operation isEqualToString:@"status"]) arguments = @[@"login", @"status"];
        else if ([operation isEqualToString:@"connect"]) arguments = @[@"login"];
        else if ([operation isEqualToString:@"logout"]) arguments = @[@"logout"];
    } else if ([agent isEqualToString:@"claude"]) {
        if ([operation isEqualToString:@"status"]) arguments = @[@"auth", @"status", @"--json"];
        else if ([operation isEqualToString:@"connect"]) arguments = @[@"auth", @"login", @"--claudeai"];
        else if ([operation isEqualToString:@"logout"]) arguments = @[@"auth", @"logout"];
    }
    if (!arguments) return;

    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:executable];
    task.arguments = arguments;
    task.currentDirectoryURL = [NSURL fileURLWithPath:NSHomeDirectory() isDirectory:YES];
    NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
    NSString *path = environment[@"PATH"] ?: @"";
    environment[@"PATH"] = [NSString stringWithFormat:@"/opt/homebrew/bin:/usr/local/bin:%@/.volta/bin:%@/.local/bin:%@/bin:%@", NSHomeDirectory(), NSHomeDirectory(), NSHomeDirectory(), path];
    environment[@"NO_COLOR"] = @"1";
    task.environment = environment;
    NSPipe *stdoutPipe = [NSPipe pipe];
    NSPipe *stderrPipe = [NSPipe pipe];
    task.standardOutput = stdoutPipe;
    task.standardError = stderrPipe;
    NSMutableData *stdoutData = [NSMutableData data];
    NSMutableData *stderrData = [NSMutableData data];
    stdoutPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
        NSData *data = handle.availableData;if (data.length) @synchronized (stdoutData) { [stdoutData appendData:data]; }
    };
    stderrPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
        NSData *data = handle.availableData;if (data.length) @synchronized (stderrData) { [stderrData appendData:data]; }
    };
    __weak typeof(self) weakSelf = self;
    task.terminationHandler = ^(NSTask *finished) {
        stdoutPipe.fileHandleForReading.readabilityHandler = nil;
        stderrPipe.fileHandleForReading.readabilityHandler = nil;
        NSData *tailOut = [stdoutPipe.fileHandleForReading readDataToEndOfFile];
        NSData *tailErr = [stderrPipe.fileHandleForReading readDataToEndOfFile];
        if (tailOut.length) @synchronized (stdoutData) { [stdoutData appendData:tailOut]; }
        if (tailErr.length) @synchronized (stderrData) { [stderrData appendData:tailErr]; }
        NSString *out = [[NSString alloc] initWithData:stdoutData encoding:NSUTF8StringEncoding] ?: @"";
        NSString *err = [[NSString alloc] initWithData:stderrData encoding:NSUTF8StringEncoding] ?: @"";
        NSString *detail = out.length ? out : err;
        dispatch_async(dispatch_get_main_queue(), ^{
            [weakSelf.authTasks removeObjectForKey:agent];
            if ([operation isEqualToString:@"status"]) {
                [weakSelf emit:@{ @"type": @"authStatus", @"agent": agent,
                                  @"connected": @(finished.terminationStatus == 0),
                                  @"message": detail.length ? detail : (finished.terminationStatus == 0 ? @"연결됨" : @"연결되지 않음") }];
            } else {
                [weakSelf emit:@{ @"type": @"authResult", @"agent": agent, @"operation": operation,
                                  @"success": @(finished.terminationStatus == 0), @"message": detail }];
                [weakSelf runAuthOperation:@"status" agent:agent config:config];
            }
        });
    };
    NSError *error = nil;
    if (![task launchAndReturnError:&error]) {
        [self emit:@{ @"type": @"authStatus", @"agent": agent, @"connected": @NO,
                      @"message": error.localizedDescription ?: @"인증 명령 실행 실패" }];
        return;
    }
    self.authTasks[agent] = task;
    [self emit:@{ @"type": @"authProgress", @"agent": agent, @"operation": operation }];
}

- (void)openExternalURL:(NSString *)value {
    if (![value isKindOfClass:[NSString class]]) return;
    NSURLComponents *components = [NSURLComponents componentsWithString:value];
    NSString *scheme = components.scheme.lowercaseString;
    if ((![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) || !components.URL) {
        [self emit:@{ @"type": @"linkError", @"message": @"http 또는 https 링크만 열 수 있습니다." }];
        return;
    }
    [[NSWorkspace sharedWorkspace] openURL:components.URL];
}

- (void)refreshCodexUsage:(NSDictionary *)config {
    if (![config isKindOfClass:[NSDictionary class]]) return;
    if (self.usageTask.isRunning) return;
    NSString *executable = config[@"executablePath"];
    if (![[NSFileManager defaultManager] isExecutableFileAtPath:executable]) {
        [self emit:@{ @"type": @"usageError", @"message": @"Codex CLI 실행 파일을 찾을 수 없습니다." }];
        return;
    }

    NSTask *task = [[NSTask alloc] init];
    self.usageTask = task;
    task.executableURL = [NSURL fileURLWithPath:executable];
    task.arguments = @[@"app-server", @"--stdio"];
    NSString *workspace = config[@"workspacePath"] ?: NSHomeDirectory();
    task.currentDirectoryURL = [NSURL fileURLWithPath:workspace isDirectory:YES];
    NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
    NSString *path = environment[@"PATH"] ?: @"";
    environment[@"PATH"] = [NSString stringWithFormat:@"/opt/homebrew/bin:/usr/local/bin:%@/.volta/bin:%@/.local/bin:%@/bin:%@", NSHomeDirectory(), NSHomeDirectory(), NSHomeDirectory(), path];
    environment[@"TERM"] = @"dumb";
    environment[@"NO_COLOR"] = @"1";
    if ([config[@"authMode"] isEqualToString:@"apiKey"]) {
        NSString *token = [self tokenForAgent:@"codex"];
        if (token.length == 0) {
            self.usageTask = nil;
            [self emit:@{ @"type": @"usageError", @"message": @"Codex API 키가 저장되어 있지 않습니다." }];
            return;
        }
        environment[@"CODEX_API_KEY"] = token;
    }
    task.environment = environment;

    NSPipe *outputPipe = [NSPipe pipe];
    NSPipe *inputPipe = [NSPipe pipe];
    task.standardOutput = outputPipe;
    task.standardError = outputPipe;
    task.standardInput = inputPipe;
    NSMutableData *buffer = [NSMutableData data];
    __block BOOL resolved = NO;
    __block BOOL requestedLimits = NO;
    __weak typeof(self) weakSelf = self;
    outputPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
        NSData *chunk = handle.availableData;
        if (!chunk.length || resolved) return;
        [buffer appendData:chunk];
        NSData *newline = [NSData dataWithBytes:"\n" length:1];
        NSRange range;
        while ((range = [buffer rangeOfData:newline options:0 range:NSMakeRange(0, buffer.length)]).location != NSNotFound) {
            NSData *lineData = [buffer subdataWithRange:NSMakeRange(0, range.location)];
            [buffer replaceBytesInRange:NSMakeRange(0, NSMaxRange(range)) withBytes:NULL length:0];
            NSDictionary *event = lineData.length ? [NSJSONSerialization JSONObjectWithData:lineData options:0 error:nil] : nil;
            if ([event isKindOfClass:[NSDictionary class]] && event[@"error"] && ([event[@"id"] integerValue] == 1 || [event[@"id"] integerValue] == 2)) {
                resolved = YES;
                NSString *message = [event[@"error"] isKindOfClass:[NSDictionary class]] ? event[@"error"][@"message"] : nil;
                [weakSelf emit:@{ @"type": @"usageError", @"message": message ?: @"Codex 사용량 프로토콜 오류" }];
                [inputPipe.fileHandleForWriting closeFile];
                if (task.isRunning) [task terminate];
                break;
            } else if ([event isKindOfClass:[NSDictionary class]] && [event[@"id"] integerValue] == 1 && event[@"result"] && !requestedLimits) {
                requestedLimits = YES;
                NSArray *followups = @[
                    @{ @"method": @"initialized", @"params": @{} },
                    @{ @"id": @2, @"method": @"account/rateLimits/read", @"params": NSNull.null }
                ];
                NSMutableData *followupData = [NSMutableData data];
                for (NSDictionary *request in followups) {
                    NSData *json = [NSJSONSerialization dataWithJSONObject:request options:0 error:nil];
                    if (json) [followupData appendData:json];
                    [followupData appendBytes:"\n" length:1];
                }
                [inputPipe.fileHandleForWriting writeData:followupData];
            } else if ([event isKindOfClass:[NSDictionary class]] && [event[@"id"] integerValue] == 2 && [event[@"result"] isKindOfClass:[NSDictionary class]]) {
                resolved = YES;
                [weakSelf emit:@{ @"type": @"usage", @"agent": @"codex", @"data": event[@"result"] }];
                [inputPipe.fileHandleForWriting closeFile];
                if (task.isRunning) [task terminate];
                break;
            }
        }
    };
    task.terminationHandler = ^(NSTask *finished) {
        outputPipe.fileHandleForReading.readabilityHandler = nil;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (weakSelf.usageTask == task) weakSelf.usageTask = nil;
            if (!resolved) [weakSelf emit:@{ @"type": @"usageError", @"message": @"Codex 계정 한도 응답을 받지 못했습니다." }];
        });
    };

    NSError *launchError = nil;
    if (![task launchAndReturnError:&launchError]) {
        self.usageTask = nil;
        [self emit:@{ @"type": @"usageError", @"message": launchError.localizedDescription ?: @"사용량 조회 실행 실패" }];
        return;
    }
    NSDictionary *initialize = @{ @"id": @1, @"method": @"initialize", @"params": @{ @"clientInfo": @{ @"name": @"triad-room", @"version": @"0.10.0" } } };
    NSMutableData *input = [[NSJSONSerialization dataWithJSONObject:initialize options:0 error:nil] mutableCopy];
    [input appendBytes:"\n" length:1];
    [inputPipe.fileHandleForWriting writeData:input];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (!resolved && task.isRunning) {
            [inputPipe.fileHandleForWriting closeFile];
            [task terminate];
        }
    });
}

- (void)setupDatabase {
    NSFileManager *manager = NSFileManager.defaultManager;
    NSURL *support = [manager URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
    NSURL *directory = [support URLByAppendingPathComponent:@"TriadRoom" isDirectory:YES];
    [manager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:nil];
    NSURL *databaseURL = [directory URLByAppendingPathComponent:@"conversations.sqlite3"];
    if (sqlite3_open(databaseURL.path.UTF8String, &_database) != SQLITE_OK) return;
    const char *sql =
        "CREATE TABLE IF NOT EXISTS conversations ("
        "id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at REAL NOT NULL, "
        "updated_at REAL NOT NULL, payload TEXT NOT NULL);"
        "CREATE INDEX IF NOT EXISTS conversations_updated_at ON conversations(updated_at DESC);";
    sqlite3_exec(self.database, sql, NULL, NULL, NULL);
}

- (NSArray *)loadConversations {
    if (!self.database) return @[];
    sqlite3_stmt *statement = NULL;
    const char *sql = "SELECT payload FROM conversations ORDER BY updated_at DESC";
    if (sqlite3_prepare_v2(self.database, sql, -1, &statement, NULL) != SQLITE_OK) return @[];
    NSMutableArray *items = [NSMutableArray array];
    while (sqlite3_step(statement) == SQLITE_ROW) {
        const unsigned char *text = sqlite3_column_text(statement, 0);
        if (!text) continue;
        NSData *data = [[NSString stringWithUTF8String:(const char *)text] dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *item = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if ([item isKindOfClass:[NSDictionary class]]) [items addObject:item];
    }
    sqlite3_finalize(statement);
    return items;
}

- (void)saveConversation:(NSDictionary *)conversation {
    if (!self.database || ![conversation isKindOfClass:[NSDictionary class]]) return;
    NSString *identifier = conversation[@"id"];
    NSString *title = conversation[@"title"];
    NSNumber *createdAt = conversation[@"createdAt"];
    NSNumber *updatedAt = conversation[@"updatedAt"];
    if (![identifier isKindOfClass:[NSString class]] || ![title isKindOfClass:[NSString class]]) return;
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:conversation options:0 error:nil];
    NSString *payload = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    if (!payload) return;

    sqlite3_stmt *statement = NULL;
    const char *sql = "INSERT INTO conversations(id,title,created_at,updated_at,payload) VALUES(?,?,?,?,?) "
                      "ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at,payload=excluded.payload";
    if (sqlite3_prepare_v2(self.database, sql, -1, &statement, NULL) != SQLITE_OK) return;
    sqlite3_bind_text(statement, 1, identifier.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 2, title.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_double(statement, 3, createdAt.doubleValue);
    sqlite3_bind_double(statement, 4, updatedAt.doubleValue);
    sqlite3_bind_text(statement, 5, payload.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_step(statement);
    sqlite3_finalize(statement);
}

- (void)deleteConversation:(NSString *)identifier {
    if (!self.database || ![identifier isKindOfClass:[NSString class]]) return;
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "DELETE FROM conversations WHERE id=?", -1, &statement, NULL) != SQLITE_OK) return;
    sqlite3_bind_text(statement, 1, identifier.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_step(statement);
    sqlite3_finalize(statement);
}

- (NSDictionary *)setupBrokerForAgent:(NSString *)agent request:(NSDictionary *)request {
    if (![request[@"mcpEnabled"] boolValue]) return nil;
    NSDictionary *agentConfigs = request[@"agentConfigs"];
    if (![agentConfigs isKindOfClass:[NSDictionary class]] || ![agentConfigs[@"codex"] isKindOfClass:[NSDictionary class]] || ![agentConfigs[@"claude"] isKindOfClass:[NSDictionary class]]) return nil;
    NSString *nodePath = [self firstExecutable:@[
        @"/opt/homebrew/bin/node", @"/usr/local/bin/node",
        [NSHomeDirectory() stringByAppendingPathComponent:@".volta/bin/node"],
        [NSHomeDirectory() stringByAppendingPathComponent:@".local/bin/node"]
    ]];
    NSString *brokerPath = [[NSBundle mainBundle] pathForResource:@"triad-mcp-server" ofType:@"cjs"];
    if (!nodePath.length || !brokerPath.length) {
        [self emit:@{ @"type": @"brokerWarning", @"agent": agent, @"message": @"AI 간 호출 도구를 시작할 Node.js 또는 브로커 파일을 찾지 못했습니다. 기존 인계 방식으로 진행합니다." }];
        return nil;
    }
    NSString *identifier = NSUUID.UUID.UUIDString.lowercaseString;
    NSString *base = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"triad-broker-%@", identifier]];
    NSString *configPath = [base stringByAppendingString:@".json"];
    NSString *statePath = [base stringByAppendingString:@".state.json"];
    NSString *eventsPath = [base stringByAppendingString:@".events.jsonl"];
    NSInteger callLimit = [request[@"collaboration"][@"rounds"] integerValue];
    if (callLimit < 1) callLimit = 6;
    if (callLimit > 10) callLimit = 10;
    NSDictionary *payload = @{
        @"nodePath": nodePath, @"brokerPath": brokerPath, @"statePath": statePath, @"eventsPath": eventsPath,
        @"callLimit": @(callLimit), @"maxDepth": @2, @"timeoutMs": @300000, @"agents": agentConfigs
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    if (![data writeToFile:configPath options:NSDataWritingAtomic error:nil]) return nil;
    [@"" writeToFile:eventsPath atomically:YES encoding:NSUTF8StringEncoding error:nil];
    NSData *stateData = [NSJSONSerialization dataWithJSONObject:@{ @"used": @0, @"limit": @(callLimit) } options:0 error:nil];
    [stateData writeToFile:statePath options:NSDataWritingAtomic error:nil];
    NSDictionary *permissions = @{ NSFilePosixPermissions: @0600 };
    NSFileManager *manager = NSFileManager.defaultManager;
    [manager setAttributes:permissions ofItemAtPath:configPath error:nil];
    [manager setAttributes:permissions ofItemAtPath:statePath error:nil];
    [manager setAttributes:permissions ofItemAtPath:eventsPath error:nil];
    NSDictionary *artifacts = @{ @"configPath": configPath, @"statePath": statePath, @"eventsPath": eventsPath, @"nodePath": nodePath, @"brokerPath": brokerPath };
    self.brokerArtifacts[agent] = artifacts;
    [self startBrokerEventsForAgent:agent artifacts:artifacts];
    return artifacts;
}

- (void)startBrokerEventsForAgent:(NSString *)agent artifacts:(NSDictionary *)artifacts {
    NSTask *tail = [[NSTask alloc] init];
    tail.executableURL = [NSURL fileURLWithPath:@"/usr/bin/tail"];
    tail.arguments = @[@"-n", @"0", @"-F", artifacts[@"eventsPath"]];
    NSPipe *pipe = [NSPipe pipe];tail.standardOutput = pipe;tail.standardError = [NSPipe pipe];
    __block NSMutableString *buffer = [NSMutableString string];
    __weak typeof(self) weakSelf = self;
    pipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
        NSData *data = handle.availableData;if (!data.length) return;
        NSString *chunk = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];if (!chunk) return;
        @synchronized (buffer) {
            [buffer appendString:chunk];
            while (YES) {
                NSRange newline = [buffer rangeOfString:@"\n"];
                if (newline.location == NSNotFound) break;
                NSString *line = [buffer substringToIndex:newline.location];
                [buffer deleteCharactersInRange:NSMakeRange(0, newline.location + 1)];
                NSData *lineData = [line dataUsingEncoding:NSUTF8StringEncoding];
                NSDictionary *event = lineData.length ? [NSJSONSerialization JSONObjectWithData:lineData options:0 error:nil] : nil;
                if ([event isKindOfClass:[NSDictionary class]]) {
                    NSMutableDictionary *message = [event mutableCopy];message[@"type"] = @"brokerEvent";message[@"rootAgent"] = agent;
                    [weakSelf emit:message];
                }
            }
        }
    };
    NSError *error = nil;
    if ([tail launchAndReturnError:&error]) self.brokerEventTasks[agent] = tail;
    else [self emit:@{ @"type": @"brokerWarning", @"agent": agent, @"message": error.localizedDescription ?: @"AI 호출 이벤트 감시를 시작하지 못했습니다." }];
}

- (void)cleanupBrokerForAgent:(NSString *)agent {
    NSTask *tail = self.brokerEventTasks[agent];if (tail.isRunning) [tail terminate];
    [self.brokerEventTasks removeObjectForKey:agent];
    NSDictionary *artifacts = self.brokerArtifacts[agent];[self.brokerArtifacts removeObjectForKey:agent];
    for (NSString *key in @[@"configPath", @"statePath", @"eventsPath"]) {
        NSString *path = artifacts[key];if (path.length) [NSFileManager.defaultManager removeItemAtPath:path error:nil];
    }
    NSString *statePath = artifacts[@"statePath"];
    if (statePath.length) [NSFileManager.defaultManager removeItemAtPath:[statePath stringByAppendingString:@".lock"] error:nil];
}

- (NSString *)JSONString:(id)value fallback:(NSString *)fallback {
    NSData *data = value ? [NSJSONSerialization dataWithJSONObject:value options:0 error:nil] : nil;
    return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : fallback;
}

- (void)runAgent:(NSDictionary *)request {
    NSString *agent = request[@"agent"];
    NSString *prompt = request[@"prompt"];
    NSDictionary *config = request[@"config"];
    NSString *session = request[@"session"];

    if (![agent isKindOfClass:[NSString class]] ||
        ![prompt isKindOfClass:[NSString class]] ||
        ![config isKindOfClass:[NSDictionary class]]) return;

    if (self.tasks[agent] != nil) {
        [self emit:@{@"type": @"error", @"agent": agent, @"message": @"이미 작업 중입니다."}];
        return;
    }

    NSString *executable = config[@"executablePath"];
    if (![[NSFileManager defaultManager] isExecutableFileAtPath:executable]) {
        [self emit:@{
            @"type": @"error", @"agent": agent,
            @"message": [NSString stringWithFormat:@"CLI 실행 파일을 찾을 수 없습니다: %@", executable ?: @""]
        }];
        return;
    }

    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:executable];
    NSString *workspace = config[@"workspacePath"] ?: NSHomeDirectory();
    task.currentDirectoryURL = [NSURL fileURLWithPath:workspace isDirectory:YES];
    NSDictionary *broker = [self setupBrokerForAgent:agent request:request];
    NSArray *brokerArgs = broker ? @[broker[@"brokerPath"], @"--config", broker[@"configPath"], @"--caller", agent, @"--depth", @"0"] : nil;

    NSMutableArray<NSString *> *arguments = [NSMutableArray array];
    NSString *model = config[@"model"] ?: @"";
    NSString *effort = config[@"effort"] ?: @"medium";
    NSString *speed = config[@"speedMode"] ?: @"standard";
    NSString *permission = config[@"permissionMode"] ?: @"workspace-write";
    BOOL networkAccess = [config[@"networkAccess"] boolValue];
    BOOL allowLocalBinding = [config[@"allowLocalBinding"] boolValue];
    NSArray<NSString *> *writableRoots = [self writableRootsFromConfig:config];
    NSString *writableRootsConfig = [self writableRootsCodexConfig:config];

    if ([agent isEqualToString:@"codex"]) {
        [arguments addObject:@"exec"];
        if ([session isKindOfClass:[NSString class]] && session.length > 0) {
            [arguments addObjectsFromArray:@[
                @"resume", @"--json", @"--skip-git-repo-check",
                @"--model", model,
                @"--config", [NSString stringWithFormat:@"model_reasoning_effort=\"%@\"", effort],
                @"--config", [NSString stringWithFormat:@"sandbox_mode=\"%@\"", permission],
                session
            ]];
        } else {
            [arguments addObjectsFromArray:@[
                @"--json", @"--color", @"never", @"--skip-git-repo-check",
                @"--cd", workspace,
                @"--model", model,
                @"--config", [NSString stringWithFormat:@"model_reasoning_effort=\"%@\"", effort],
                @"--sandbox", permission
            ]];
        }
        if ([permission isEqualToString:@"workspace-write"] && writableRootsConfig.length) {
            [arguments addObjectsFromArray:@[@"--config", writableRootsConfig]];
        }
        if ([permission isEqualToString:@"workspace-write"] && (networkAccess || allowLocalBinding)) {
            [arguments addObjectsFromArray:@[@"--config", @"sandbox_workspace_write.network_access=true"]];
        }
        if ([permission isEqualToString:@"workspace-write"] && allowLocalBinding) {
            [arguments addObjectsFromArray:@[
                @"--config", @"features.network_proxy.enabled=true",
                @"--config", @"features.network_proxy.allow_local_binding=true"
            ]];
            if (networkAccess) {
                [arguments addObjectsFromArray:@[@"--config", @"features.network_proxy.domains={ \"*\" = \"allow\" }"]];
            }
        }
        if ([speed isEqualToString:@"fast"]) {
            [arguments addObjectsFromArray:@[@"--enable", @"fast_mode", @"--config", @"service_tier=\"fast\""]];
        } else {
            [arguments addObjectsFromArray:@[@"--disable", @"fast_mode"]];
        }
        if (broker) {
            NSString *command = [self JSONString:broker[@"nodePath"] fallback:@"\"node\""];
            NSString *argsJSON = [self JSONString:brokerArgs fallback:@"[]"];
            [arguments addObjectsFromArray:@[@"--config", [NSString stringWithFormat:@"mcp_servers.triad.command=%@", command], @"--config", [NSString stringWithFormat:@"mcp_servers.triad.args=%@", argsJSON]]];
        }
        [arguments addObject:@"-"];
    } else {
        NSMutableDictionary *claudeSettings = [@{@"fastMode": @([speed isEqualToString:@"fast"])} mutableCopy];
        NSMutableDictionary *claudeSandbox = [NSMutableDictionary dictionary];
        if (writableRoots.count) claudeSandbox[@"filesystem"] = @{@"allowWrite": writableRoots};
        NSMutableDictionary *claudeNetwork = [NSMutableDictionary dictionary];
        if (networkAccess) claudeNetwork[@"allowedDomains"] = @[@"*"];
        if (allowLocalBinding) claudeNetwork[@"allowLocalBinding"] = @YES;
        if (claudeNetwork.count) claudeSandbox[@"network"] = claudeNetwork;
        if (claudeSandbox.count) claudeSettings[@"sandbox"] = claudeSandbox;
        NSData *settingsData = [NSJSONSerialization dataWithJSONObject:claudeSettings options:0 error:nil];
        NSString *settingsJSON = [[NSString alloc] initWithData:settingsData encoding:NSUTF8StringEncoding] ?: @"{}";
        [arguments addObjectsFromArray:@[
            @"--print",
            @"--output-format", @"stream-json",
            @"--verbose",
            @"--include-partial-messages",
            @"--model", model,
            @"--effort", effort,
            @"--permission-mode", permission,
            @"--settings", settingsJSON
        ]];
        if ([permission isEqualToString:@"bypassPermissions"]) {
            [arguments addObject:@"--allow-dangerously-skip-permissions"];
        }
        if (writableRoots.count) {
            [arguments addObject:@"--add-dir"];
            [arguments addObjectsFromArray:writableRoots];
        }
        if (broker) {
            NSDictionary *mcp = @{ @"mcpServers": @{ @"triad": @{ @"command": broker[@"nodePath"], @"args": brokerArgs } } };
            [arguments addObjectsFromArray:@[@"--mcp-config", [self JSONString:mcp fallback:@"{}"]]];
        }
        if ([session isKindOfClass:[NSString class]] && session.length > 0) {
            [arguments addObjectsFromArray:@[@"--resume", session]];
        } else {
            NSString *newSession = NSUUID.UUID.UUIDString.lowercaseString;
            [arguments addObjectsFromArray:@[@"--session-id", newSession]];
        }
    }
    task.arguments = arguments;

    NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
    NSString *path = environment[@"PATH"] ?: @"";
    environment[@"PATH"] = [NSString stringWithFormat:@"/opt/homebrew/bin:/usr/local/bin:%@/.volta/bin:%@/.local/bin:%@/bin:%@", NSHomeDirectory(), NSHomeDirectory(), NSHomeDirectory(), path];
    environment[@"TERM"] = @"dumb";
    environment[@"NO_COLOR"] = @"1";

    NSDictionary *allConfigs = [request[@"agentConfigs"] isKindOfClass:[NSDictionary class]] ? request[@"agentConfigs"] : @{ agent: config };
    for (NSString *configuredAgent in @[@"codex", @"claude"]) {
        NSDictionary *agentConfig = allConfigs[configuredAgent];
        if (![agentConfig[@"authMode"] isEqualToString:@"apiKey"]) continue;
        NSString *token = [self tokenForAgent:configuredAgent];
        if (token.length == 0 && [configuredAgent isEqualToString:agent]) {
            [self cleanupBrokerForAgent:agent];
            [self emit:@{@"type": @"error", @"agent": agent, @"message": @"키체인에 저장된 API 키가 없습니다."}];
            return;
        }
        if (token.length && [configuredAgent isEqualToString:@"codex"]) environment[@"CODEX_API_KEY"] = token;
        if (token.length && [configuredAgent isEqualToString:@"claude"]) environment[@"ANTHROPIC_API_KEY"] = token;
    }
    task.environment = environment;

    NSPipe *stdoutPipe = [NSPipe pipe];
    NSPipe *stderrPipe = [NSPipe pipe];
    NSPipe *stdinPipe = [NSPipe pipe];
    task.standardOutput = stdoutPipe;
    task.standardError = stderrPipe;
    task.standardInput = stdinPipe;

    __weak typeof(self) weakSelf = self;
    stdoutPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
        NSData *data = handle.availableData;
        if (data.length == 0) return;
        NSString *chunk = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if (chunk) [weakSelf emit:@{@"type": @"raw", @"agent": agent, @"chunk": chunk}];
    };
    stderrPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
        NSData *data = handle.availableData;
        if (data.length == 0) return;
        NSString *chunk = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if (chunk) [weakSelf emit:@{@"type": @"stderr", @"agent": agent, @"chunk": chunk}];
    };

    task.terminationHandler = ^(NSTask *finished) {
        stdoutPipe.fileHandleForReading.readabilityHandler = nil;
        stderrPipe.fileHandleForReading.readabilityHandler = nil;
        dispatch_async(dispatch_get_main_queue(), ^{
            [weakSelf.tasks removeObjectForKey:agent];
            [weakSelf emit:@{
                @"type": @"terminated", @"agent": agent,
                @"exitCode": @(finished.terminationStatus)
            }];
            [weakSelf notifyAgentCompletion:agent exitCode:finished.terminationStatus];
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ [weakSelf cleanupBrokerForAgent:agent]; });
        });
    };

    NSError *error = nil;
    if (![task launchAndReturnError:&error]) {
        [self cleanupBrokerForAgent:agent];
        [self emit:@{@"type": @"error", @"agent": agent, @"message": error.localizedDescription ?: @"실행 실패"}];
        return;
    }
    self.tasks[agent] = task;
    NSData *promptData = [prompt dataUsingEncoding:NSUTF8StringEncoding];
    [stdinPipe.fileHandleForWriting writeData:promptData];
    [stdinPipe.fileHandleForWriting closeFile];
}

- (void)stopAgent:(NSString *)agent {
    NSTask *task = self.tasks[agent];
    if (task.isRunning) [task interrupt];
}

- (void)chooseDirectoryForAgent:(NSString *)agent {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.canChooseFiles = NO;
    panel.canChooseDirectories = YES;
    panel.allowsMultipleSelection = NO;
    panel.prompt = @"선택";
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) {
        if (result == NSModalResponseOK && panel.URL.path) {
            [self emit:@{@"type": @"directory", @"agent": agent ?: @"", @"path": panel.URL.path}];
        }
    }];
}

- (void)chooseFilesFromWorkspace:(NSString *)workspace {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.canChooseFiles = YES;
    panel.canChooseDirectories = NO;
    panel.allowsMultipleSelection = YES;
    panel.prompt = @"참조";
    if ([workspace isKindOfClass:[NSString class]] && workspace.length > 0) {
        panel.directoryURL = [NSURL fileURLWithPath:workspace isDirectory:YES];
    }
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) {
        if (result != NSModalResponseOK) return;
        NSMutableArray *paths = [NSMutableArray array];
        for (NSURL *url in panel.URLs) if (url.path) [paths addObject:url.path];
        [self emit:@{@"type": @"files", @"paths": paths}];
    }];
}

- (NSString *)firstExecutable:(NSArray<NSString *> *)paths {
    for (NSString *path in paths) {
        if ([[NSFileManager defaultManager] isExecutableFileAtPath:path]) return path;
    }
    return nil;
}

- (NSArray<NSString *> *)writableRootsFromConfig:(NSDictionary *)config {
    NSString *raw = [config[@"writableRoots"] isKindOfClass:[NSString class]] ? config[@"writableRoots"] : @"";
    NSMutableArray<NSString *> *roots = [NSMutableArray array];
    NSCharacterSet *separators = [NSCharacterSet characterSetWithCharactersInString:@",\n"];
    for (NSString *value in [raw componentsSeparatedByCharactersInSet:separators]) {
        NSString *path = [[value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] stringByExpandingTildeInPath];
        if (path.length && ![roots containsObject:path]) [roots addObject:path];
    }
    return roots;
}

- (NSString *)writableRootsCodexConfig:(NSDictionary *)config {
    NSArray<NSString *> *roots = [self writableRootsFromConfig:config];
    if (!roots.count) return nil;
    NSMutableArray<NSString *> *quoted = [NSMutableArray array];
    for (NSString *root in roots) {
        NSString *escaped = [[root stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"] stringByReplacingOccurrencesOfString:@"\"" withString:@"\\\""];
        [quoted addObject:[NSString stringWithFormat:@"\"%@\"", escaped]];
    }
    NSString *array = [NSString stringWithFormat:@"[%@]", [quoted componentsJoinedByString:@","]];
    return [NSString stringWithFormat:@"sandbox_workspace_write.writable_roots=%@", array];
}

- (NSArray *)codexModelCatalog {
    NSString *path = [NSHomeDirectory() stringByAppendingPathComponent:@".codex/models_cache.json"];
    NSData *data = [NSData dataWithContentsOfFile:path];
    if (!data) return @[];
    NSDictionary *root = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    NSArray *models = [root isKindOfClass:[NSDictionary class]] ? root[@"models"] : nil;
    if (![models isKindOfClass:[NSArray class]]) return @[];

    NSMutableArray *catalog = [NSMutableArray array];
    for (NSDictionary *model in models) {
        if (![model isKindOfClass:[NSDictionary class]]) continue;
        NSString *slug = model[@"slug"];
        if (![slug isKindOfClass:[NSString class]] || slug.length == 0) continue;
        NSMutableArray *efforts = [NSMutableArray array];
        for (NSDictionary *level in model[@"supported_reasoning_levels"] ?: @[]) {
            NSString *effort = [level isKindOfClass:[NSDictionary class]] ? level[@"effort"] : nil;
            if ([effort isKindOfClass:[NSString class]]) [efforts addObject:effort];
        }
        NSArray *tiers = model[@"additional_speed_tiers"];
        BOOL supportsFast = [tiers isKindOfClass:[NSArray class]] && [tiers containsObject:@"fast"];
        [catalog addObject:@{
            @"slug": slug,
            @"name": model[@"display_name"] ?: slug,
            @"efforts": efforts,
            @"defaultEffort": model[@"default_reasoning_level"] ?: @"medium",
            @"supportsFast": @(supportsFast)
        }];
    }
    return catalog;
}

- (NSArray *)claudeModelCatalogForExecutable:(NSString *)executable {
    NSArray<NSDictionary *> *defaults = @[
        @{@"slug": @"default", @"name": @"Default (계정 권장)"},
        @{@"slug": @"best", @"name": @"Best"},
        @{@"slug": @"sonnet", @"name": @"Sonnet"},
        @{@"slug": @"opus", @"name": @"Opus"},
        @{@"slug": @"haiku", @"name": @"Haiku"},
        @{@"slug": @"sonnet[1m]", @"name": @"Sonnet · 1M"},
        @{@"slug": @"opus[1m]", @"name": @"Opus · 1M"},
        @{@"slug": @"opusplan", @"name": @"Opus Plan"},
        @{@"slug": @"fable", @"name": @"Fable"}
    ];
    NSMutableArray<NSDictionary *> *catalog = [defaults mutableCopy];
    NSMutableSet<NSString *> *seen = [NSMutableSet set];
    for (NSDictionary *model in defaults) [seen addObject:model[@"slug"]];
    if (![[NSFileManager defaultManager] isExecutableFileAtPath:executable]) return catalog;

    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:executable];
    task.arguments = @[@"--help"];
    NSPipe *output = [NSPipe pipe];
    task.standardOutput = output;
    task.standardError = [NSPipe pipe];
    NSError *error = nil;
    if (![task launchAndReturnError:&error]) return catalog;
    NSData *data = [output.fileHandleForReading readDataToEndOfFile];
    [task waitUntilExit];
    NSString *help = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
    NSRange start = [help rangeOfString:@"--model <model>"];
    if (start.location == NSNotFound) return catalog;
    NSRange tail = NSMakeRange(start.location, help.length - start.location);
    NSRange next = [help rangeOfString:@"\n  -n," options:0 range:tail];
    NSRange section = NSMakeRange(start.location, (next.location == NSNotFound ? help.length : next.location) - start.location);
    NSString *description = [help substringWithRange:section];
    NSRegularExpression *quoted = [NSRegularExpression regularExpressionWithPattern:@"'([^']+)'" options:0 error:nil];
    for (NSTextCheckingResult *match in [quoted matchesInString:description options:0 range:NSMakeRange(0, description.length)]) {
        NSString *slug = [description substringWithRange:[match rangeAtIndex:1]];
        if (slug.length == 0 || [seen containsObject:slug]) continue;
        BOOL plausible = [slug hasPrefix:@"claude-"] || [slug rangeOfString:@" "].location == NSNotFound;
        if (!plausible) continue;
        [seen addObject:slug];
        NSString *name = [slug hasPrefix:@"claude-"] ? slug : slug.capitalizedString;
        [catalog addObject:@{@"slug": slug, @"name": name}];
    }
    return catalog;
}

- (void)emit:(NSDictionary *)payload {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSError *error = nil;
        NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&error];
        if (!data || error) return;
        NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        [self.webView evaluateJavaScript:[NSString stringWithFormat:@"window.nativeEvent(%@)", json]
                       completionHandler:nil];
    });
}

- (NSMutableDictionary *)keychainQueryForAgent:(NSString *)agent {
    return [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: kKeychainService,
        (__bridge id)kSecAttrAccount: agent
    } mutableCopy];
}

- (NSString *)tokenForAgent:(NSString *)agent {
    if (!agent) return nil;
    NSMutableDictionary *query = [self keychainQueryForAgent:agent];
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status != errSecSuccess || result == NULL) return nil;
    NSData *data = CFBridgingRelease(result);
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

- (void)saveToken:(NSString *)token forAgent:(NSString *)agent {
    NSString *trimmed = [token stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (!agent || trimmed.length == 0) {
        [self emit:@{@"type": @"tokenError", @"agent": agent ?: @"", @"message": @"토큰을 입력해주세요."}];
        return;
    }
    [self deleteTokenSilentlyForAgent:agent];
    NSMutableDictionary *query = [self keychainQueryForAgent:agent];
    query[(__bridge id)kSecValueData] = [trimmed dataUsingEncoding:NSUTF8StringEncoding];
    query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
    if (status != errSecSuccess) {
        NSString *message = CFBridgingRelease(SecCopyErrorMessageString(status, NULL)) ?: @"키체인 저장 실패";
        [self emit:@{@"type": @"tokenError", @"agent": agent, @"message": message}];
    } else {
        [self emitTokenStatus];
    }
}

- (void)deleteTokenSilentlyForAgent:(NSString *)agent {
    if (!agent) return;
    NSMutableDictionary *query = [self keychainQueryForAgent:agent];
    SecItemDelete((__bridge CFDictionaryRef)query);
}

- (void)deleteTokenForAgent:(NSString *)agent {
    [self deleteTokenSilentlyForAgent:agent];
    [self emitTokenStatus];
}

- (void)emitTokenStatus {
    [self emit:@{
        @"type": @"tokenStatus",
        @"status": @{
            @"codex": @([self tokenForAgent:@"codex"] != nil),
            @"claude": @([self tokenForAgent:@"claude"] != nil)
        }
    }];
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        app.delegate = delegate;
        app.activationPolicy = NSApplicationActivationPolicyRegular;
        [app run];
    }
    return 0;
}
