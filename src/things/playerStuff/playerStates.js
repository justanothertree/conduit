// playerStates.js — state definitions extracted from Player.setupStates().
// Behavior-preserving move (2026-09-27): every `this` in the original
// method was the player, so it is now spelled `player`. The state driver
// (handleInput/decideState/setState/getInput) still lives on Player.

export function setupPlayerStates(player) {
        player.stateLockout = 0;
        player.currentState = 'idle';
        player.slidePower = 0;
        player.slamCD = 0;
        player.healCD = 0;
        player.wallRunLeft = 540;
        player.wallRunRight = 540;
        player.dashDuration = 250;

        player.wallrunDecayRate = .5;
        // idle: {
        //     enter: () => { },
        //     update: () => { },
        //     exit: () => { },
        // },

        function lerp(start, end, t) {
            return start + (end - start) * t;
        }

        player.states = {
            idle: {
                enter: () => {
                    player.resetJump();
                    player.tryUncrouch();
                    player.isSlamming = 0;
                    player.meditateTimer = 0;
                },
                update: (delta) => {
                    player.setVelocityX(player.walkLerp(delta, 0));
                },
                exit: () => { },
            },

            meditate: {
                enter: () => {
                    player.isMeditating = 1;
                    // Create particle manager
                    player.meditateEmitter = player.scene.add.particles(player.x, player.y, 'greenFlame', {
                        speed: 100,
                        lifespan: 500,
                        alpha: .35,
                        scale: { start: 1, end: 0 },
                        blendMode: 'ADD',
                    });

                },
                update: (delta) => {
                    player.setVelocityX(player.walkLerp(delta, 0))
                    player.healCD += delta / 500;

                    if (player.healCD >= 1) {
                        if (player.health >= player.healthMax) return;
                        player.healCD = 0;
                        player.updateHealth(1);
                    }
                },
                exit: () => {
                    player.meditateEmitter.stop();
                    player.isMeditating = 0;
                    player.meditateTimer = 0;
                },
            },

            walk: {
                enter: () => {
                    player.resetJump();
                    player.tryUncrouch();
                    player.isSlamming = 0;
                    player.isWalking = true;
                    if (!player.network.socket.connected) {
                        player.network.socket.connect();
                    }
                },
                update: (delta, input) => {
                    const { left, right } = input;
                    const dir = player.speed * player.dir;
                    player.tryUncrouch();

                    player.setVelocityX(player.walkLerp(delta, dir));
                },
                exit: () => {
                    player.isWalking = false;
                },
            },

            fall: {
                enter: () => {
                    player.canJump = false;
                    player.falling = true;
                },
                update: (delta, input) => {
                    const { left, right, jump } = input;
                    const dir = (left ? -1 : right ? 1 : 0) * (player.speed);
                    if ((left && !right && (player.body.velocity.x > -250)) || (!left && right && (player.body.velocity.x < 250))) {
                        player.setVelocityX(player.walkLerp(delta, dir, .1));
                    } else {
                        player.setVelocityX(player.walkLerp(delta, 0, .005));
                    }

                    player.tryUncrouch();
                    if (player.body.velocity.y >= 0) {
                        player.reachApex = true;
                    }
                    // jump && 
                    if ((player.body.blocked.left || player.body.blocked.right)) {
                        player.setState('wallSlide', input);
                    }

                },
                exit: () => {
                    player.falling = false;
                    player.isMantling = false;
                    player.setMaxVelocity(1500, 1500);
                },
            },

            wallSlide: {
                enter: () => {
                    player.wallSlide = true;
                },
                update: (delta, input) => {
                    const { left, right, jump } = input;
                    const dir = (left ? -1 : right ? 1 : 0) * (player.speed);
                    if ((left && !right) || (!left && right)) {
                        player.setVelocityX(player.walkLerp(delta, dir, .1));
                    } else {
                        if (player.body.blocked.left) {
                            player.setVelocityX(-1);
                            player.flipX = true;
                        }
                        if (player.body.blocked.right) {
                            player.setVelocityX(1);
                            player.flipX = false;
                        }
                        // if (jump) {
                        //     const jumpHeight = leftJump ? player.wallRunLeft : player.wallRunRight;
                        //     player.setState('wallJump', { left: leftJump, right: !leftJump, height: jumpHeight });
                        // }
                    }
                    if (player.body.velocity.y > 350) {
                        player.setVelocityY(lerp(player.body.velocity.y, 350, .035));
                    }
                    if (jump) {
                        player.setState('wallRun', input);
                    }
                    if ((!player.body.blocked.left && !player.body.blocked.right) || player.body.blocked.down) {
                        player.wallSlide = false;
                    }
                },
                exit: () => {
                    player.wallSlide = false;
                },
            },

            wallRun: {
                enter: (input) => {
                    const { left, right } = input;
                    player.wallRunning = true;
                    player.stopRun = false;
                    const xSpeed = Math.min(800, Math.abs(player.body.velocity.x));

                    if (player.body.blocked.left) {
                        if (player.wallRunLeft < (-player.body.velocity.y)) {
                            player.wallRunLeft = (-player.body.velocity.y)
                        } else if (player.wallRunLeft < xSpeed) {
                            player.wallRunLeft = Math.min(xSpeed, 680);
                        }
                        player.wallRunRight = 540;
                        player.wallJumpRightMin = 540;
                    }

                    if (player.body.blocked.right) {
                        if (player.wallRunRight < (-player.body.velocity.y)) {
                            player.wallRunRight = (-player.body.velocity.y)
                        } else if (player.wallRunRight < xSpeed) {
                            player.wallRunRight = Math.min(xSpeed, 680);
                        }
                        player.wallRunLeft = 540;
                        player.wallJumpLeftMin = 540;
                    }
                    player.wallrunDecayRate = .5;

                },
                update: (delta, input, time) => {
                    const { left, right, jump } = input;

                    //const dir = (left ? -1 : right ? 1 : 0) * (player.speed);

                    // if ((left && !right) || (!left && right)) {
                    //     player.setVelocityX(dir);
                    // } else {
                    //     player.setVelocityX(player.walkLerp(delta, 0, .02));
                    // }

                    if (player.body.blocked.left) {
                        player.setVelocityY(-player.wallRunLeft);
                        player.setVelocityX(-1);

                        player.wallRunLeft = Math.max(-200, player.wallRunLeft - (player.wallrunDecayRate * delta));
                        player.bufferLeftWallJump = player.scene.time.now + 55;
                        player.bufferRightWallJump = 0;

                        const leftBuffer = true;
                        if (right || !jump) {
                            player.setState('wallJump', { left: leftBuffer, right: false, height: player.wallRunLeft })
                        }

                        if (player.wallRunLeft <= 0) {
                            player.wallSlide = true;
                        }
                        // if (!left && !player.stopRun) {
                        //     player.stopRun = true;
                        //     player.wallRunLeft = 0;
                        // }

                        // if (!left && !player.stopRun) {
                        //     player.stopRun = true;
                        //     player.wallRunLeft = player.wallRunLeft > 0 ? 0 : player.wallRunLeft;
                        //     //player.wallrunDecayRate = 3;
                        // }
                    }
                    if (player.body.blocked.right) {
                        player.setVelocityY(-player.wallRunRight);
                        player.setVelocityX(1);
                        player.wallRunRight = Math.max(-200, player.wallRunRight - (player.wallrunDecayRate * delta));
                        player.bufferRightWallJump = player.scene.time.now + 55;
                        player.bufferLeftWallJump = 0;

                        const rightBuffer = true;
                        if (left || !jump) {
                            player.setState('wallJump', { left: false, right: rightBuffer, height: player.wallRunRight })
                        }

                        if (player.wallRunRight <= 0) {
                            player.wallSlide = true;
                        }
                        // if (!right && !player.stopRun) {
                        //     player.stopRun = true;
                        //     player.wallRunRight = 0;
                        // }

                        // if (!right && !player.stopRun) {
                        //     player.stopRun = true;
                        //     player.wallRunRight = player.wallRunRight > 0 ? 0 : player.wallRunRight;
                        //     //player.wallrunDecayRate = 3;
                        // }
                    }
                    if (player.body.blocked.up) {
                        player.wallRunLeft = 0;
                        player.wallRunRight = 0;
                        player.wallRunning = false;
                        player.wallSlide = true;
                    }

                    const leftBuffer = player.bufferLeftWallJump > player.scene.time.now;
                    const rightBuffer = player.bufferRightWallJump > player.scene.time.now

                    if ((right && !left) && rightBuffer && !player.body.blocked.right) {
                        player.setVelocityY(0);
                        player.setVelocityX(250);
                        player.isMantling = player.scene.time.now;
                    }
                    if ((left && !right) && leftBuffer && !player.body.blocked.left) {
                        player.setVelocityY(0);
                        player.setVelocityX(-250);
                        player.isMantling = player.scene.time.now;
                    }
                    if (!player.body.blocked.left && !player.body.blocked.right) {
                        player.wallRunning = false;
                    }
                    // !jump || 
                    // if (((right && jump) && leftBuffer) || ((left && jump) && rightBuffer)) {
                    //     const jumpHeight = leftBuffer ? player.wallRunLeft : player.wallRunRight;
                    //     player.setState('wallJump', { left: leftBuffer, right: rightBuffer, height: jumpHeight })
                    // }

                },
                exit: () => {
                    player.wallRunning = false;
                    player.wallSlide = false;
                },
            },

            wallJump: {
                enter: ({ left, right, height }) => {
                    player.isWallJumping = true;
                    player.wallJumpTimer = player.scene.time.now;
                    player.isMantling = 0;
                    player.stateLockout = player.scene.time.now + 25;

                    if (right) {
                        player.setVelocity(-350, Phaser.Math.Clamp(-height, -680, -player.wallJumpRightMin));
                        player.flipX = true;
                        player.bufferRightWallJump = 0;
                        player.wallRunRight /= 2;
                        player.wallJumpRightMin = 100;
                        player.dir = -1;
                    }
                    if (left) {
                        player.setVelocity(350, Phaser.Math.Clamp(-height, -680, -player.wallJumpLeftMin));
                        player.flipX = false;
                        player.bufferLeftWallJump = 0;
                        player.wallRunLeft /= 2;
                        player.wallJumpLeftMin = 100;
                        player.dir = 1;
                    }
                },
                update: () => { },
                exit: () => {
                    player.wallSlide = false;
                },
            },

            crouch: {
                enter: (input) => {
                    const { left, right } = input;
                    player.isCrouch = true;
                    player.hitBoxSize = { y: 180, yo: 70 };
                    player.setSize(115, 180);
                    player.setOffset(70, 70);

                    if (player.body.blocked.down && (!left && !right)) {
                        player.slidePower = 100;
                    }

                    player.stop();
                    player.setFrame(6);
                },
                update: (delta, input) => {
                    const { left, right, crouch } = input;
                    const dir = (left ? -1 : right ? 1 : 0) * (player.speed / 2);
                    if ((left && !right && (player.body.velocity.x > -250)) || (!left && right && (player.body.velocity.x < 250))) {
                        player.setVelocityX(player.walkLerp(delta, dir, .1));
                    } else {
                        player.setVelocityX(player.walkLerp(delta, 0, .02));
                    }

                    if (player.body.blocked.down) {
                        player.resetJump();
                        player.isSlamming = 0;

                        if ((left || right) && player.slidePower > 100) {
                            player.setState('slide');
                            return;
                        }
                    }
                },
                exit: () => {
                },
            },

            slam: {
                enter: (input) => {
                    player.isSlamming = player.scene.time.now;
                    const { left, right } = input;
                    const move = (left ? -1 : right ? 1 : 0) * (player.speed);
                    player.slamCD = 800;
                    player.setVelocity(move * 1.125, Math.max(350, player.body.velocity.y));
                },
                update: () => { },
                exit: () => { },
            },

            slide: {
                enter: () => {
                    const currentSpeed = Math.abs(player.body.velocity.x);
                    const speed = currentSpeed > player.slidePower ? currentSpeed * player.dir : player.slidePower * player.dir;
                    player.slidePower = 0;

                    player.isSliding = true;
                    player.canSlide = false;
                    player.setVelocityX(speed);

                    player.slideTime = player.scene.time.now + 500;
                    player.stateLockout = player.slideTime;

                    player.stop();
                    player.setFrame(9);
                },
                update: (delta, input) => {
                    if (Math.abs(player.body.velocity.x) < 150) {
                        player.stateLockout = 0;
                        player.setState('crouch', input);
                        return;
                    }

                    if (!input.crouch) {
                        player.stateLockout = 0;
                        player.setState('idle');
                        return;
                    }

                    if (input.jump && player.canJump && player.body.blocked.down) {
                        player.stateLockout = 0;
                        player.setState('jump', input);
                        return;
                    }

                    if (player.slideTime <= player.scene.time.now && input.crouch) {
                        player.stateLockout = 0;
                        player.setState('crouch', input);
                        return;
                    }


                    if (input.dash && player.canDash) {
                        player.stateLockout = 0;
                        player.setState('dash', input);
                        return;
                    }
                },
                exit: () => {
                    player.isSliding = false;
                },
            },

            jump: {
                enter: (input) => {
                    player.isJumping = true;
                    player.reachApex = false;
                    player.jumpPower = 200;
                    player.jumpMax = 425;
                    player.isSlamming = 0;
                    player.setVelocityY(-player.jumpPower);
                    player.tryUncrouch();

                    player.stop();
                    player.setFrame(5);
                },
                update: (delta, input) => {
                    const { left, right, jump } = input;
                    const move = (left ? -1 : right ? 1 : 0) * player.speed;
                    player.setVelocityY(-player.jumpPower);
                    player.setVelocityX(player.walkLerp(delta, move, .2))
                    player.jumpPower += delta * 1.5;

                    if (player.jumpPower >= player.jumpMax) {
                        player.canJump = false;
                    }
                },
                exit: () => {
                    player.isJumping = false;
                    player.canJump = false;
                },
            },

            dash: {
                enter: () => {
                    player.stateLockout = player.scene.time.now + player.dashDuration;

                    player.canDash = false;
                    player.canResetDash = false;
                    player.isDashing = true;
                    player.iFrame = true;
                    player.body.setAllowGravity(false);
                    player.tryUncrouch();
                    player.wallRunLeft = 540;
                    player.wallRunRight = 540;

                    player.dashTime = 0;
                    player.startDash = player.dashSpeed * player.dir;
                    player.endDash = player.startDash / 3;

                    player.thisDashCooldownTimer = player.scene.time.addEvent({
                        delay: 650,
                        callback: () => {
                            player.canResetDash = true;
                            if (player.queResetDash) player.resetDash();
                        }
                    });
                    player.clearTint();
                },
                update: (delta, input) => {
                    player.dashTime += delta;

                    const t = Phaser.Math.Clamp((player.dashTime) / player.dashDuration, 0, 1);
                    const currentSpeed = lerp(player.startDash, player.endDash, t)
                    if (isNaN(currentSpeed)) {

                        player.setVelocityX(0);
                    } else {
                        player.setVelocityX(currentSpeed);
                        player.setVelocityY(0);
                    }

                    if (player.body.blocked.left || player.body.blocked.right) {
                        player.stateLockout = 0;
                        if (input.jump) {
                            player.body.blocked.left ? player.wallRunLeft = 540 : player.wallRunRight = 540;
                            player.setState('wallRun', input);
                        } else {
                            player.setState('idle');
                        }
                    }
                    if (input.crouch && !player.slamCD) {
                        player.stateLockout = 0;
                        player.setState('slam', input);
                    }
                },
                exit: () => {
                    player.body.setAllowGravity(true);
                    player.isDashing = false;
                    player.iFrame = false;
                },
            },

            grapple: {
                enter: (hitLocation) => {
                    player.isGrappling = true;

                    const dx = player.x - hitLocation.x;
                    const dy = player.y - hitLocation.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const tangX = -dy / dist;
                    const tangY = dx / dist;
                    const tangVel = (player.body.velocity.x * tangX) + (player.body.velocity.y * tangY);
                    const angle = Math.atan2(dy, dx);
                },
                update: () => { },
                exit: () => {
                    player.isGrappling = false;
                },
            },

            heal: {
                enter: () => {
                    player.isHealing = true;
                    player.setMaxVelocity(135, 135);
                    player.tryUncrouch();
                },
                update: (delta, input) => {
                    const { left, right } = input;
                    const move = (left ? -1 : right ? 1 : 0) * (player.speed);
                    player.setVelocityX(player.walkLerp(delta, move))
                    player.healCD += delta / 250;

                    if (player.healCD >= 1) {
                        if (player.health >= player.healthMax) return;
                        player.healCD = 0;
                        player.updateHealth(1);
                        player.updateMoney(-1);
                    }
                },
                exit: () => {
                    player.isHealing = false;
                    player.setMaxVelocity(1500, 1500);
                },
            },
        }
}
