import "dart:async";
import "dart:io";
import "dart:math";

import 'package:flutter/material.dart';
import 'package:logging/logging.dart';
import "package:photos/l10n/l10n.dart";
import 'package:photos/ui/common/gradient_button.dart';
import 'package:photos/ui/tools/app_lock.dart';
import 'package:photos/utils/auth_util.dart';
import "package:photos/utils/lockscreen_setting.dart";

class LockScreen extends StatefulWidget {
  const LockScreen({Key? key}) : super(key: key);

  @override
  State<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends State<LockScreen> with WidgetsBindingObserver {
  final _logger = Logger("LockScreen");
  bool _isShowingLockScreen = false;
  bool _hasPlacedAppInBackground = false;
  bool _hasAuthenticationFailed = false;
  int? lastAuthenticatingTime;
  bool isTimerRunning = false;
  int lockedTime = 0;
  int invalidAttemptCount = 0;
  int remainingTime = 0;
  final _lockscreenSetting = LockscreenSetting.instance;

  @override
  void initState() {
    _logger.info("initiatingState");
    super.initState();
    invalidAttemptCount = _lockscreenSetting.getInvalidAttemptCount();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((timeStamp) {
      if (isNonMobileIOSDevice()) {
        _logger.info('ignore init for non mobile iOS device');
        return;
      }
      _showLockScreen(source: "postFrameInit");
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            Stack(
              alignment: Alignment.center,
              children: [
                Opacity(
                  opacity: 0.2,
                  child: Image.asset('assets/loading_photos_background.png'),
                ),
                SizedBox(
                  width: 180,
                  child: GradientButton(
                    text: isTimerRunning
                        ? formatTime(remainingTime)
                        : context.l10n.unlock,
                    iconData: Icons.lock_open_outlined,
                    onTap: () async {
                      if (!isTimerRunning) {
                        await _showLockScreen(source: "tapUnlock");
                      }
                    },
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  bool isNonMobileIOSDevice() {
    if (Platform.isAndroid) {
      return false;
    }
    final shortestSide = MediaQuery.of(context).size.shortestSide;
    return shortestSide > 600 ? true : false;
  }

  @override
  Future<void> didChangeAppLifecycleState(AppLifecycleState state) async {
    _logger.info(state.toString());
    if (state == AppLifecycleState.resumed && !_isShowingLockScreen) {
      _hasPlacedAppInBackground = false;
      final bool didAuthInLast5Seconds = lastAuthenticatingTime != null &&
          DateTime.now().millisecondsSinceEpoch - lastAuthenticatingTime! <
              5000;

      if (!_hasAuthenticationFailed && !didAuthInLast5Seconds) {
        if (_lockscreenSetting.getlastInvalidAttemptTime() >
                DateTime.now().millisecondsSinceEpoch &&
            !_isShowingLockScreen) {
          final int time = (_lockscreenSetting.getlastInvalidAttemptTime() -
                  DateTime.now().millisecondsSinceEpoch) ~/
              1000;

          Future.delayed(
            Duration.zero,
            () {
              startLockTimer(time);
              _showLockScreen(source: "lifeCycle");
            },
          );
        }
      } else {
        _hasAuthenticationFailed = false;
      }
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive) {
      if (!_isShowingLockScreen) {
        _hasPlacedAppInBackground = true;
        _hasAuthenticationFailed = false;
      }
    }
  }

  @override
  void dispose() {
    _logger.info('disposing');
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> startLockTimer(int time) async {
    if (isTimerRunning) {
      return;
    }

    setState(() {
      isTimerRunning = true;
      remainingTime = time;
    });

    while (remainingTime > 0) {
      await Future.delayed(const Duration(seconds: 1));
      setState(() {
        remainingTime--;
      });
    }

    setState(() {
      isTimerRunning = false;
    });
  }

  String formatTime(int seconds) {
    final int hours = seconds ~/ 3600;
    final int minutes = (seconds % 3600) ~/ 60;
    final int remainingSeconds = seconds % 60;

    if (hours > 0) {
      return "$hours hr $minutes min";
    } else if (minutes > 0) {
      return "$minutes min $remainingSeconds sec";
    } else {
      return "$remainingSeconds sec";
    }
  }

  Future<void> _showLockScreen({String source = ''}) async {
    final int id = DateTime.now().millisecondsSinceEpoch;
    _logger.info("Showing lock screen $source $id");
    try {
      if (id < _lockscreenSetting.getlastInvalidAttemptTime() &&
          !_isShowingLockScreen) {
        final int time =
            (_lockscreenSetting.getlastInvalidAttemptTime() - id) ~/ 1000;

        await startLockTimer(time);
      }
      _isShowingLockScreen = true;
      final result = isTimerRunning
          ? false
          : await requestAuthentication(
              context,
              context.l10n.authToViewYourMemories,
              isLockscreenAuth: true,
            );
      _logger.finest("LockScreen Result $result $id");
      _isShowingLockScreen = false;
      if (result) {
        lastAuthenticatingTime = DateTime.now().millisecondsSinceEpoch;
        AppLock.of(context)!.didUnlock();
        await _lockscreenSetting.setInvalidAttemptCount(0);
        setState(() {
          lockedTime = 15;
          isTimerRunning = false;
        });
      } else {
        if (!_hasPlacedAppInBackground) {
          if (_lockscreenSetting.getInvalidAttemptCount() > 4 &&
              invalidAttemptCount !=
                  _lockscreenSetting.getInvalidAttemptCount()) {
            invalidAttemptCount = _lockscreenSetting.getInvalidAttemptCount();
            lockedTime = pow(2, invalidAttemptCount - 5).toInt() * 30;
            await _lockscreenSetting.setLastInvalidAttemptTime(
              DateTime.now().millisecondsSinceEpoch + lockedTime * 1000,
            );
            await startLockTimer(lockedTime);
          }
          _hasAuthenticationFailed = true;
          _logger.info("Authentication failed");
        }
      }
    } catch (e, s) {
      _isShowingLockScreen = false;
      _logger.severe(e, s);
    }
  }
}
