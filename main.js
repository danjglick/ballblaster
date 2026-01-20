// npx --yes live-server --host=0.0.0.0 --port=8080
// http://10.0.0.145:8080

const FPS = 30
const MS_PER_FRAME = 1000 / FPS
function getShim() { return (canvas?.width || window.innerWidth) / 10 }
function getBallRadius() { return (canvas?.width || window.innerWidth) / 20 }
function getTargetRadius() { return (canvas?.width || window.innerWidth) / 20 }
const FRICTION = .99
const FLING_DIVISOR = 2
const BALL_STOP_SPEED = 10 // Higher threshold so we treat the ball as "stopped" sooner
const TOUCH_TOLERANCE = 20 // Extra pixels for touch detection
const SPAWN_ANIMATION_DURATION = 700 // ms for ball spawn animation
const FADE_DURATION = 1000 // ms for fade animations
const TROPHY_PLACEMENT_DELAY = 2000 // ms delay before placing trophy
const TUTORIAL_FADE_DELAY = 2000 // ms delay before fading tutorial
const OBSTACLE_FADE_DELAY = 1000 // ms delay before fading obstacles
const BALL_MIN_CONTINUE_SPEED = 3 // If above this and path will clear all targets, don't auto-reset yet
const AUTO_RESET_DURATION = 1000 // ms for ball move-back + target fade-in

let canvas;
let ctx;
let ball = {
	xPos: 0,
	yPos: 0,
	xVel: 0,
	yVel: 0,
	isBeingFlung: false,
	fadeOpacity: 1.0
}
let targets = []
let targetsRemaining = []
let obstacles = []
let trophy = null // Trophy that appears after collecting all targets
let savedTargets = [] // Saved positions for retry
let savedObstacles = [] // Saved positions for retry
let savedBall = null // Saved ball position for retry
let isConvertingObstacle = false
let selectedForConversion = null // { type: 'obstacle' | 'target', index: number }
let touch1 = {
	xPos: 0,
	yPos: 0
}
// Track where the last target was collected so we can place the trophy there
let lastTargetX = null
let lastTargetY = null
// Track previous ball position so we can animate to the next level's starting spot
let previousBallX = null
let previousBallY = null
// Track whether we've already completed at least one level (so we can skip
// the spawn animation for the very first level).
let hasCompletedALevel = false
// Simple three-step tutorial for level 1
let tutorialStep = 0 // 0 = off, 1..3 = active steps
let tutorialCompleted = false
// Remember last on-screen tutorial position so follow-up levels can reuse it.
let tutorialLastX = null
let tutorialLastY = null
// For the very first level only, fade in the grey ball and score.
let initialIntroActive = true
let initialIntroStartTime = 0
// Track when a "shot" is in progress (ball has been flung this level)
let shotActive = false
// Track auto-reset animation when a shot fails (ball moves back, targets fade in)
let autoResetActive = false
let autoResetStartTime = 0
let autoResetBallFromX = 0
let autoResetBallFromY = 0
let autoResetBallToX = 0
let autoResetBallToY = 0
let tries = 0
let levelScore = 0
let totalScore = 0
let pointsThisLevel = 0 // Track points gained during current level for retry
let completionScore = 0 // Score for completing levels (clearing all targets)
let scoreIncrementDisplay = null // { opacity: 1.0, timeLeft: 1.0, amount: 1 } for showing +1 indicator
let level = 0
let gameLoopTimeout = null
let fireworks = []
let obstacleExplosionTimeout = null
let tutorialExplosionTimeout = null
let nextLevelTimeout = null
let isGeneratingLevel = false
let pendingNextLevel = false

function initializeGame() {
	canvas = document.getElementById("canvas")
	resizeCanvas()
	ctx = canvas.getContext('2d')
	
	// Start the very first level with a fade-in of the grey ball and score.
	initialIntroActive = true
	initialIntroStartTime = Date.now()
	ball.fadeOpacity = 0.0
	window.addEventListener("resize", resizeCanvas)
	document.addEventListener("touchstart", handleTouchstart)
	document.addEventListener("touchmove", handleTouchmove, { passive: false })
	document.addEventListener("touchend", handleTouchend)
	let retryButton = document.getElementById("retryButton")
	let nextButton = document.getElementById("nextButton")
	
	// Hide buttons
	if (retryButton) {
		retryButton.style.display = "none"
	}
	if (nextButton) {
		nextButton.style.display = "none"
	}
	
	let retryTouchStartTime = 0
	let nextTouchStartTime = 0
	
	let handleRetry = (e) => {
		e.preventDefault()
		e.stopPropagation()
		e.stopImmediatePropagation()
		// If tries === 0, go to next level with one fewer target and obstacle
		if (tries === 0) {
			generateLevel(false, true) // false = not a normal retry, true = fewer sprites
		} else {
			generateLevel(true)
		}
		return false
	}
	
	let handleNext = (e) => {
		e.preventDefault()
		e.stopPropagation()
		e.stopImmediatePropagation()
		generateLevel()
		return false
	}
	
	retryButton.addEventListener("touchstart", (e) => {
		e.preventDefault()
		e.stopPropagation()
		retryTouchStartTime = Date.now()
	}, { passive: false })
	
	retryButton.addEventListener("touchend", (e) => {
		e.preventDefault()
		e.stopPropagation()
		// Only trigger if touch was quick (not a long press)
		if (Date.now() - retryTouchStartTime < 500) {
			handleRetry(e)
		}
	}, { passive: false })
	
	retryButton.addEventListener("click", handleRetry, { passive: false })
	
	nextButton.addEventListener("touchstart", (e) => {
		e.preventDefault()
		e.stopPropagation()
		nextTouchStartTime = Date.now()
	}, { passive: false })
	
	nextButton.addEventListener("touchend", (e) => {
		e.preventDefault()
		e.stopPropagation()
		// Only trigger if touch was quick (not a long press)
		if (Date.now() - nextTouchStartTime < 500) {
			handleNext(e)
		}
	}, { passive: false })
	
	nextButton.addEventListener("click", handleNext, { passive: false })
	document.addEventListener("wheel", (e) => e.preventDefault(), { passive: false })
	// Prevent zoom gestures
	document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false })
	document.addEventListener("gesturechange", (e) => e.preventDefault(), { passive: false })
	document.addEventListener("gestureend", (e) => e.preventDefault(), { passive: false })
	generateLevel()
}

function generateLevel(isRetry = false, fewerSprites = false) {
	// Check tries before resetting - if retrying with tries > 0, restore saved positions
	let shouldRestorePositions = isRetry && !fewerSprites && tries > 0
	
	// Remember the previous ball position so we can animate into the next level's
	// starting spot — but ONLY after the first level has been completed.
	if (ball && !isRetry && hasCompletedALevel) {
		previousBallX = ball.xPos
		previousBallY = ball.yPos
	} else if (!ball) {
		previousBallX = null
		previousBallY = null
	}
	
	// If retry (normal retry or retry going to next level), remove points gained during current level
	if (isRetry || (fewerSprites && pointsThisLevel > 0)) {
		totalScore -= pointsThisLevel
	}
	if (!isRetry || fewerSprites) {
		if (!fewerSprites) {
			level++
		}
		if (fewerSprites) {
			placeTargetsWithCount(5)
			placeObstaclesWithCount(5)
		} else {
			placeTargets()
			placeObstacles()
		}
		placeBall()
		// Save positions after placing (for future retries)
		savedTargets = JSON.parse(JSON.stringify(targets))
		savedObstacles = JSON.parse(JSON.stringify(obstacles))
		savedBall = JSON.parse(JSON.stringify(ball))
	} else {
		// Normal retry - restore obstacles and targets for current level
		// Level stays the same, so tutorial stays the same
		if (shouldRestorePositions && savedTargets.length > 0 && savedObstacles.length > 0 && savedBall) {
			// Restore saved positions
			targets = JSON.parse(JSON.stringify(savedTargets))
			obstacles = JSON.parse(JSON.stringify(savedObstacles))
			ball = JSON.parse(JSON.stringify(savedBall))
			// Reset ball velocity
			ball.xVel = 0
			ball.yVel = 0
			ball.isBeingFlung = false
		} else {
			// Generate new positions (first retry or no saved positions)
			placeTargets()
			placeObstacles()
			placeBall()
			// Save positions for future retries
			savedTargets = JSON.parse(JSON.stringify(targets))
			savedObstacles = JSON.parse(JSON.stringify(obstacles))
			savedBall = JSON.parse(JSON.stringify(ball))
		}
	}
	targetsRemaining = JSON.parse(JSON.stringify(targets))
	fireworks = []
	trophy = null // Reset trophy for new level
	pendingNextLevel = false
	autoResetActive = false
 
	// Ensure grey ball is fully visible (no fade behavior)
	if (ball) {
		ball.fadeOpacity = 1.0
	}

	// If this is a new level AFTER the first completion (not a retry) and we know
	// where the ball was before, animate the ball moving from its previous position
	// into the new starting spot.
	if (!isRetry && hasCompletedALevel && previousBallX !== null && previousBallY !== null) {
		// Store the spawn animation state on the ball
		ball.spawnFromX = previousBallX
		ball.spawnFromY = previousBallY
		ball.spawnToX = ball.xPos
		ball.spawnToY = ball.yPos
		ball.spawnStartTime = Date.now()
		ball.isSpawningToStart = true

		// Start the ball visually at the previous location, stationary
		ball.xPos = previousBallX
		ball.yPos = previousBallY
		ball.xVel = 0
		ball.yVel = 0
		ball.isBeingFlung = false
	}
	selectedForConversion = null
	scoreIncrementDisplay = null // Reset score increment display
	// Clear any pending timeouts
	if (obstacleExplosionTimeout !== null) {
		clearTimeout(obstacleExplosionTimeout)
		obstacleExplosionTimeout = null
	}
	if (tutorialExplosionTimeout !== null) {
		clearTimeout(tutorialExplosionTimeout)
		tutorialExplosionTimeout = null
	}
	if (nextLevelTimeout !== null) {
		clearTimeout(nextLevelTimeout)
		nextLevelTimeout = null
	}
	levelScore = 0
	pointsThisLevel = 0 // Reset points gained this level
	tries = 0
	// Initialize or clear tutorial for this level
	if (level === 1 && !tutorialCompleted) {
		// Level 1: full multi-step tutorial (fling, hit, switch)
		tutorialStep = 1
	} else if (level === 2) {
		// Level 2: single reminder about switching mechanic
		tutorialStep = 1
	} else {
		tutorialStep = 0
	}
	updateTutorial()
	if (gameLoopTimeout !== null) {
		clearTimeout(gameLoopTimeout)
		gameLoopTimeout = null
	}
	// Draw immediately so UI (level indicator) doesn't "flash" during the 100ms restart delay
	draw()
	// Small delay to prevent zoom issues during level reload, then resume
	setTimeout(() => {
		isGeneratingLevel = false
		loopGame()
	}, 100)
}

function loopGame() { // MAIN GAME LOOP
	moveBall()
	handleCollision()
	draw()
	gameLoopTimeout = setTimeout(loopGame, MS_PER_FRAME)
}

function convertTargetAndObstacle(targetIndex, obstacleIndex) {
	let target = targetsRemaining[targetIndex]
	let obstacle = obstacles[obstacleIndex]
	let targetRadius = getTargetRadius()
	
	// Save positions
	let obstacleX = obstacle.xPos
	let obstacleY = obstacle.yPos
	let targetX = target.xPos
	let targetY = target.yPos
	
	// Remove both from their arrays
	obstacles.splice(obstacleIndex, 1)
	targetsRemaining.splice(targetIndex, 1)
	
	// Convert obstacle to target (at obstacle's position)
	targetsRemaining.push({
		xPos: obstacleX,
		yPos: obstacleY
	})
	
	// Convert target to obstacle (at target's position)
	obstacles.push({
		xPos: targetX,
		yPos: targetY,
		radius: targetRadius
	})
	
	selectedForConversion = null
	isConvertingObstacle = true
}

function handleTouchstart(e) {
	// Convert screen coordinates to canvas coordinates
	let canvasRect = canvas.getBoundingClientRect()
	touch1 = {
		xPos: e.touches[0].clientX - canvasRect.left,
		yPos: e.touches[0].clientY - canvasRect.top
	}
	isConvertingObstacle = false
	
	// While ball is animating to its new starting spot for the next level,
	// or auto-resetting after a failed shot, ignore user input so they can't
	// fling it mid-animation.
	if (ball && (ball.isSpawningToStart || autoResetActive)) {
		return
	}
	
	let targetRadius = getTargetRadius()
	let ballRadius = getBallRadius()
	
	// Check if tapping on an obstacle (check before ball to prioritize smaller targets)
	for (let i = obstacles.length - 1; i >= 0; i--) {
		let obstacle = obstacles[i]
		let distance = Math.hypot(touch1.xPos - obstacle.xPos, touch1.yPos - obstacle.yPos)
		if (distance < targetRadius + TOUCH_TOLERANCE) {
			if (selectedForConversion && selectedForConversion.type === 'target') {
				// Second tap: we have a target selected, now tapping obstacle - convert both
				convertTargetAndObstacle(selectedForConversion.index, i)
				return
			} else {
				// First tap: select this obstacle
				selectedForConversion = { type: 'obstacle', index: i }
				
				// Advance tutorial to switching mechanic once player taps an obstacle.
				if (level === 1 && tutorialStep === 2 && !tutorialCompleted) {
					tutorialStep = 3
					updateTutorial()
				}
				return
			}
		}
	}
	
	// Check if tapping on a target
	for (let i = targetsRemaining.length - 1; i >= 0; i--) {
		let target = targetsRemaining[i]
		let distance = Math.hypot(touch1.xPos - target.xPos, touch1.yPos - target.yPos)
		if (distance < targetRadius + TOUCH_TOLERANCE) {
			if (selectedForConversion && selectedForConversion.type === 'obstacle') {
				// Second tap: we have an obstacle selected, now tapping target - convert both
				convertTargetAndObstacle(i, selectedForConversion.index)
				return
			} else {
				// First tap: select this target
				selectedForConversion = { type: 'target', index: i }
				
				// Advance tutorial to switching mechanic once player taps a target.
				if (level === 1 && tutorialStep === 2 && !tutorialCompleted) {
					tutorialStep = 3
					updateTutorial()
				}
				return
			}
		}
	}
	
	// Check if tapping on the ball (check after targets/obstacles to avoid blocking them)
	let ballDistance = Math.hypot(touch1.xPos - ball.xPos, touch1.yPos - ball.yPos)
	if (ballDistance < ballRadius + TOUCH_TOLERANCE) {
		// If the ball is still moving fast enough, ignore this tap so you can't "double-fling".
		let currentSpeed = Math.hypot(ball.xVel, ball.yVel)
		if (currentSpeed > BALL_STOP_SPEED) {
			return
		}

		selectedForConversion = null // Clear selection if touching ball
		ball.isBeingFlung = true
		// Start a new "shot" – we care whether this single fling clears all targets.
		shotActive = true
		// Handle tutorial progression when the ball is flung.
		// Level 1: multi-step tutorial (only advance 1 -> 2 here).
		if (level === 1 && !tutorialCompleted && tutorialStep === 1) {
			tutorialStep = 2
			updateTutorial()
		}
		// Level 2: when the ball is flung for the first time on this level,
		// show the final tutorial text. Subsequent flings on the same level
		// won't re-show it after it has faded out.
		if (level === 2 && tries === 0) {
			let tutorialOverlay = document.getElementById("tutorialOverlay")
			if (tutorialOverlay) {
				tutorialOverlay.textContent = "Think carefully, aim true, and seize glory!"
				tutorialOverlay.style.opacity = "1"
				tutorialOverlay.style.visibility = "visible"
			}
		}
		tries++
		return
	}
	
	// If tapping empty space, clear selection
	selectedForConversion = null
}

function handleTouchmove(e) {
	e.preventDefault()
	let touch2 = { 
		xPos: e.touches[0].clientX, 
		yPos: e.touches[0].clientY 
	}
	if (ball.isBeingFlung) {
		ball.xVel = (touch2.xPos - touch1.xPos) / FLING_DIVISOR
		ball.yVel = (touch2.yPos - touch1.yPos) / FLING_DIVISOR
	}
}

function handleTouchend() {
	ball.isBeingFlung = false
	isConvertingObstacle = false
}

function placeBall() {
	let radius = getBallRadius()
	let targetRadius = getTargetRadius()
	let minSeparation = 5 // Minimum gap between sprite edges
	let maxAttempts = 100
	let attempts = 0
	let xPos, yPos
	let validPosition = false
	
	while (!validPosition && attempts < maxAttempts) {
		// Ensure ball is fully within canvas bounds
		xPos = radius + (canvas.width - 2 * radius) * Math.random()
		yPos = canvas.height - getShim()
		
		// Verify yPos is within bounds (accounting for radius)
		if (yPos - radius < 0) {
			yPos = radius
		}
		if (yPos + radius > canvas.height) {
			yPos = canvas.height - radius
		}
		
		validPosition = true
		
		// Check distance from existing targets using proper Euclidean distance
		for (let i = 0; i < targets.length; i++) {
			let target = targets[i]
			let dx = xPos - target.xPos
			let dy = yPos - target.yPos
			let distance = Math.hypot(dx, dy)
			let minDistance = radius + targetRadius + minSeparation
			if (distance < minDistance) {
				validPosition = false
				break
			}
		}
		
		attempts++
	}
	
	// Fallback: ensure position is valid even if loop exhausted attempts
	if (!validPosition) {
		xPos = radius + (canvas.width - 2 * radius) * Math.random()
		yPos = Math.max(radius, Math.min(canvas.height - radius, canvas.height - getShim()))
	}

	ball = {
		xPos: xPos,
		yPos: yPos,
		xVel: 0,
		yVel: 0,
		isBeingFlung: false
	}
}

function placeTargetsWithCount(targetCount) {
	targets = []
	let radius = getTargetRadius()
	let ballRadius = getBallRadius()
	let minSeparation = 5 // Minimum gap between sprite edges
	let maxAttempts = 100
	// No exclusion zone - score and buttons are disabled
	let topExclusionZone = 0
	// Keep blue balls away from the very bottom: never within 4 grey-ball
	// diameters of the bottom edge.
	let bottomExclusion = 8 * ballRadius // 4 * (2 * ballRadius)
	
	for (let i = 0; i < targetCount; i++) {
		let attempts = 0
		let xPos, yPos
		let validPosition = false
		
		while (!validPosition && attempts < maxAttempts) {
			// Ensure target is fully within canvas bounds, and not too close
			// to the bottom edge.
			xPos = radius + (canvas.width - 2 * radius) * Math.random()
			// Exclude top area unless high level, and also exclude a band
			// near the bottom based on grey ball size.
			let minY = radius + topExclusionZone
			let maxY = canvas.height - Math.max(radius, bottomExclusion)
			yPos = minY + (maxY - minY) * Math.random()
			validPosition = true
			
			// Check distance from ball using proper Euclidean distance
			let dx = xPos - ball.xPos
			let dy = yPos - ball.yPos
			let distance = Math.hypot(dx, dy)
			let minDistance = radius + ballRadius + minSeparation
			if (distance < minDistance) {
				validPosition = false
			}
			
			// Check distance from other targets using proper Euclidean distance
			if (validPosition) {
				for (let j = 0; j < targets.length; j++) {
					let dx2 = xPos - targets[j].xPos
					let dy2 = yPos - targets[j].yPos
					let distance2 = Math.hypot(dx2, dy2)
					let minDistance2 = radius + radius + minSeparation
					if (distance2 < minDistance2) {
						validPosition = false
						break
					}
				}
			}
			
			attempts++
		}
		
		// Fallback: ensure position is valid even if loop exhausted attempts
		if (!validPosition) {
			xPos = radius + (canvas.width - 2 * radius) * Math.random()
			let minY = radius + topExclusionZone
			let maxY = canvas.height - Math.max(radius, bottomExclusion)
			yPos = minY + (maxY - minY) * Math.random()
		}
		
		targets.push({ 
			xPos: xPos, 
			yPos: yPos,
			fadeInOpacity: 0, // Start invisible for fade-in
			fadeInStartTime: Date.now()
		})
	}
}

function placeObstaclesWithCount(obstacleCount) {
	obstacles = []
	let obstacleRadius = getTargetRadius()
	let ballRadius = getBallRadius()
	let targetRadius = getTargetRadius()
	let minSeparation = 5 // Minimum gap between sprite edges
	// No exclusion zone - score and buttons are disabled
	let topExclusionZone = 0
	// Keep red balls away from the very bottom: never within 4 grey-ball
	// diameters of the bottom edge.
	let bottomExclusion = 8 * ballRadius // 4 * (2 * ballRadius)
	
	for (let i = 0; i < obstacleCount; i++) {
		let attempts = 0
		let xPos, yPos
		let validPosition = false
		
		while (!validPosition && attempts < 100) {
			// Ensure obstacle is fully within canvas bounds, and not too close
			// to the bottom edge.
			xPos = obstacleRadius + (canvas.width - 2 * obstacleRadius) * Math.random()
			// Exclude top area unless high level, and also exclude a band
			// near the bottom based on grey ball size.
			let minY = obstacleRadius + topExclusionZone
			let maxY = canvas.height - Math.max(obstacleRadius, bottomExclusion)
			yPos = minY + (maxY - minY) * Math.random()
			validPosition = true
			
			// Check distance from ball using proper Euclidean distance
			let dx = xPos - ball.xPos
			let dy = yPos - ball.yPos
			let distance = Math.hypot(dx, dy)
			let minDistance = obstacleRadius + ballRadius + minSeparation
			if (distance < minDistance) {
				validPosition = false
			}
			
			// Check distance from targets using proper Euclidean distance
			if (validPosition) {
				for (let j = 0; j < targets.length; j++) {
					let dx2 = xPos - targets[j].xPos
					let dy2 = yPos - targets[j].yPos
					let distance2 = Math.hypot(dx2, dy2)
					let minDistance2 = obstacleRadius + targetRadius + minSeparation
					if (distance2 < minDistance2) {
						validPosition = false
						break
					}
				}
			}
			
			// Check distance from other obstacles using proper Euclidean distance
			if (validPosition) {
				for (let j = 0; j < obstacles.length; j++) {
					let dx3 = xPos - obstacles[j].xPos
					let dy3 = yPos - obstacles[j].yPos
					let distance3 = Math.hypot(dx3, dy3)
					let minDistance3 = obstacleRadius + obstacles[j].radius + minSeparation
					if (distance3 < minDistance3) {
						validPosition = false
						break
					}
				}
			}
			
			attempts++
		}
		
		// Fallback: ensure position is valid even if loop exhausted attempts
		if (!validPosition) {
			xPos = obstacleRadius + (canvas.width - 2 * obstacleRadius) * Math.random()
			let minY = obstacleRadius + topExclusionZone
			let maxY = canvas.height - Math.max(obstacleRadius, bottomExclusion)
			yPos = minY + (maxY - minY) * Math.random()
		}
		
		obstacles.push({ 
			xPos: xPos, 
			yPos: yPos,
			radius: obstacleRadius,
			fadeInOpacity: 0, // Start invisible for fade-in
			fadeInStartTime: Date.now()
		})
	}
}

function placeTrophy() {
	// Make the trophy substantially larger than targets.
	let trophyRadius = getTargetRadius() * 4.5
	let ballRadius = getBallRadius()
	let minSeparation = 5
	
	// First, animate the grey ball to a random position at the bottom of the screen
	// (same animation style as level start/restart)
	// Add padding to avoid corners - keep ball away from left/right edges
	let horizontalPadding = getShim() // Same padding as vertical
	let ballTargetX = ballRadius + horizontalPadding + (canvas.width - 2 * ballRadius - 2 * horizontalPadding) * Math.random()
	let ballTargetY = canvas.height - getShim()
	
	// Verify ball target yPos is within bounds
	if (ballTargetY - ballRadius < 0) {
		ballTargetY = ballRadius
	}
	if (ballTargetY + ballRadius > canvas.height) {
		ballTargetY = canvas.height - ballRadius
	}
	
	// Set up the spawn animation to move the ball to the bottom
	ball.spawnFromX = ball.xPos
	ball.spawnFromY = ball.yPos
	ball.spawnToX = ballTargetX
	ball.spawnToY = ballTargetY
	ball.spawnStartTime = Date.now()
	ball.isSpawningToStart = true
	
	// Start the ball visually at its current location, but stop its velocity
	ball.xVel = 0
	ball.yVel = 0
	ball.isBeingFlung = false
	
	// Place the trophy at a random valid position on the board
	// Ensure it's positioned well above the ball's new bottom position
	let maxAttempts = 100
	let attempts = 0
	let xPos, yPos
	let validPosition = false
	
	// Minimum vertical separation between trophy and ball's new bottom position
	let minVerticalSeparation = 3 * (trophyRadius + ballRadius)
	let ballBottomY = ballTargetY + ballRadius
	
		while (!validPosition && attempts < maxAttempts) {
			// Random position on canvas
			xPos = trophyRadius + (canvas.width - 2 * trophyRadius) * Math.random()
			yPos = trophyRadius + (canvas.height - 2 * trophyRadius) * Math.random()
			validPosition = true
			
			// Never place the trophy in the top-right quadrant of the board
			if (xPos > canvas.width / 2 && yPos < canvas.height / 2) {
				validPosition = false
			}

			// Ensure the trophy is positioned well above the ball's new bottom position
			if (validPosition) {
				let trophyTopY = yPos - trophyRadius
				if (trophyTopY > ballBottomY - minVerticalSeparation) {
					validPosition = false
				}
			}

			// Keep the trophy away from the score in the top-right corner so it
			// never visually overlaps or hides the score digits.
			if (validPosition) {
				let scoreDigitWidth = 60   // a bit wider than a single digit
				let scoreDigitHeight = 80  // a bit taller for safety
				let scoreRight = canvas.width - 12
				let scoreLeft = scoreRight - scoreDigitWidth
				let scoreBottom = 56
				let scoreTop = scoreBottom - scoreDigitHeight

				if (
					xPos + trophyRadius > scoreLeft &&
					xPos - trophyRadius < scoreRight &&
					yPos + trophyRadius > scoreTop &&
					yPos - trophyRadius < scoreBottom
				) {
					validPosition = false
				}
			}
			
			attempts++
		}
	
	// Fallback: place at center if no valid position found
	if (!validPosition) {
		xPos = canvas.width / 2
		yPos = canvas.height / 2
		// Still ensure it's above the ball's bottom position
		if (yPos - trophyRadius > ballBottomY - minVerticalSeparation) {
			yPos = ballBottomY - minVerticalSeparation + trophyRadius
		}
	}
	
	trophy = {
		xPos: xPos,
		yPos: yPos,
		radius: trophyRadius,
		fadeInOpacity: 0, // Start invisible for fade-in
		fadeInStartTime: Date.now()
	}
	
	// Clear the last target position once we've placed the trophy
	lastTargetX = null
	lastTargetY = null
}

function placeTargets() {
	// Always use 5 targets on every level (including level 1).
	let targetCount = 5
	placeTargetsWithCount(targetCount)
}

function placeObstacles() {
	// Use fewer obstacles on the very first level to ease players in.
	// Level 1: 3 obstacles, later levels: 5 obstacles.
	let obstacleCount = (level === 1) ? 3 : 5
	placeObstaclesWithCount(obstacleCount)
}

function moveBall() {
	// If the ball is animating into its starting spot for a new level, override normal motion
	if (ball && ball.isSpawningToStart) {
		let duration = SPAWN_ANIMATION_DURATION
		let elapsed = Date.now() - ball.spawnStartTime
		let t = Math.min(1, Math.max(0, elapsed / duration))
		
		// Simple ease-out interpolation for a smoother feel
		let easeT = 1 - Math.pow(1 - t, 2)
		
		ball.xPos = ball.spawnFromX + (ball.spawnToX - ball.spawnFromX) * easeT
		ball.yPos = ball.spawnFromY + (ball.spawnToY - ball.spawnFromY) * easeT
		ball.xVel = 0
		ball.yVel = 0
		
		if (t >= 1) {
			// Snap to final position and end the spawn animation
			ball.xPos = ball.spawnToX
			ball.yPos = ball.spawnToY
			ball.isSpawningToStart = false
		}
		return
	}

	// If we're in the middle of an auto-reset (failed shot), animate the ball
	// moving back to its starting spot for this level.
	if (autoResetActive) {
		let elapsed = Date.now() - autoResetStartTime
		let t = Math.min(1, Math.max(0, elapsed / AUTO_RESET_DURATION))
		// Simple ease-out interpolation for a smoother feel
		let easeT = 1 - Math.pow(1 - t, 2)
		ball.xPos = autoResetBallFromX + (autoResetBallToX - autoResetBallFromX) * easeT
		ball.yPos = autoResetBallFromY + (autoResetBallToY - autoResetBallFromY) * easeT
		ball.xVel = 0
		ball.yVel = 0
		if (t >= 1) {
			ball.xPos = autoResetBallToX
			ball.yPos = autoResetBallToY
			autoResetActive = false
		}
		return
	}

	// Normal motion
	ball.xPos += ball.xVel
	ball.yPos += ball.yVel
	ball.xVel *= FRICTION 
	ball.yVel *= FRICTION

	// If a shot is in progress, the ball has effectively stopped (after the fling),
	// and we still have targets remaining, start a quick animated reset of this
	// level: ball glides back to its starting spot while previously-cleared
	// targets fade back in, both finishing at the same time.
	if (shotActive && !ball.isBeingFlung && !pendingNextLevel && !isGeneratingLevel && targetsRemaining.length > 0) {
		let speed = Math.hypot(ball.xVel, ball.yVel)
		if (speed < BALL_STOP_SPEED) {
			// If the ball is still moving fast enough and our simple straight-line-
			// with-friction prediction says it will clear all remaining targets,
			// don't end the run yet.
			if (speed >= BALL_MIN_CONTINUE_SPEED && willClearAllTargetsOnCurrentPath()) {
				return
			}

			shotActive = false

			// Set up ball auto-reset animation
			autoResetActive = true
			autoResetStartTime = Date.now()
			autoResetBallFromX = ball.xPos
			autoResetBallFromY = ball.yPos
			if (savedBall) {
				autoResetBallToX = savedBall.xPos
				autoResetBallToY = savedBall.yPos
			} else {
				// Fallback: use current position if we somehow don't have a saved ball
				autoResetBallToX = ball.xPos
				autoResetBallToY = ball.yPos
			}
			ball.xVel = 0
			ball.yVel = 0
			ball.isBeingFlung = false

			// Rebuild targetsRemaining from the original targets, fading back in any
			// targets that were already collected during this shot.
			if (targets && targets.length > 0) {
				let newTargetsRemaining = []
				for (let i = 0; i < targets.length; i++) {
					let fullTarget = targets[i]
					// Check if this target is still in targetsRemaining (by position)
					let exists = targetsRemaining.some(t =>
						Math.abs(t.xPos - fullTarget.xPos) < 0.5 &&
						Math.abs(t.yPos - fullTarget.yPos) < 0.5
					)
					if (exists) {
						// Keep as-is (already visible)
						newTargetsRemaining.push({
							xPos: fullTarget.xPos,
							yPos: fullTarget.yPos
						})
					} else {
						// Bring back with fade-in synced to the ball reset
						newTargetsRemaining.push({
							xPos: fullTarget.xPos,
							yPos: fullTarget.yPos,
							fadeInOpacity: 0,
							fadeInStartTime: autoResetStartTime
						})
					}
				}
				targetsRemaining = newTargetsRemaining
			}
			return
		}
	}
}

// Simple predictive check: simulate the ball's current straight-line motion with
// friction for a short time window and see if it would pass over all remaining
// targets. Ignores obstacles but is good enough to avoid ending a run
// that is clearly about to succeed.
function willClearAllTargetsOnCurrentPath() {
	if (!ball || targetsRemaining.length === 0) return false

	let simX = ball.xPos
	let simY = ball.yPos
	let simVX = ball.xVel
	let simVY = ball.yVel
	let simTargets = targetsRemaining.map(t => ({ xPos: t.xPos, yPos: t.yPos }))

	let ballRadius = getBallRadius()
	let targetRadius = getTargetRadius()
	let maxSteps = 90 // about 3 seconds at 30 FPS
	let minSpeed = 0.5

	for (let step = 0; step < maxSteps; step++) {
		// Advance simulated ball
		simX += simVX
		simY += simVY
		simVX *= FRICTION
		simVY *= FRICTION

		let speed = Math.hypot(simVX, simVY)
		if (speed < minSpeed) break

		// Check for hits on remaining targets
		for (let i = simTargets.length - 1; i >= 0; i--) {
			let t = simTargets[i]
			let dx = simX - t.xPos
			let dy = simY - t.yPos
			let dist = Math.hypot(dx, dy)
			if (dist < ballRadius + targetRadius) {
				simTargets.splice(i, 1)
			}
		}

		if (simTargets.length === 0) {
			return true
		}
	}

	return false
}

function handleCollision() {
	// While the ball is animating into its new starting spot OR auto-resetting a failed shot,
	// ignore collisions so nothing interferes with these animations.
	if (ball && (ball.isSpawningToStart || autoResetActive)) {
		return
	}
	handleCollisionWithTarget()
	handleCollisionWithObstacle()
	handleCollisionWithEdge()
	handleCollisionWithTrophy()
}

function handleCollisionWithTarget() {
	for (let i = 0; i < targetsRemaining.length; i++) {
		let target = targetsRemaining[i]
		let collisionDistance = getBallRadius() + getTargetRadius()
		let dx = ball.xPos - target.xPos
		let dy = ball.yPos - target.yPos
		let distance = Math.hypot(dx, dy)
		if (distance < collisionDistance) {
			let rewardPoints = Math.round(100 / Math.max(tries, 1))
			let wasLastTarget = targetsRemaining.length === 1
			let targetX = target.xPos
			let targetY = target.yPos
			targetsRemaining.splice(i, 1)
			totalScore += rewardPoints
			pointsThisLevel += rewardPoints
			
			// Create fireworks every time a target is collected
			createFireworks(targetX, targetY)
			
			// Fade away obstacles when last target is collected
			if (wasLastTarget) {
				// This shot successfully cleared all targets
				shotActive = false
				
				// Remember where the last target was collected so we can place the trophy there
				lastTargetX = targetX
				lastTargetY = targetY
				
				// Start fading obstacles and create red fireworks after delay
				setTimeout(() => {
					for (let j = 0; j < obstacles.length; j++) {
						let obstacle = obstacles[j]
						createFireworks(obstacle.xPos, obstacle.yPos, "red")
						obstacle.fadeOpacity = 1.0
						obstacle.fading = true
					}
				}, OBSTACLE_FADE_DELAY)
				
				// Fade tutorial text after delay
				tutorialExplosionTimeout = setTimeout(() => {
					let tutorialOverlay = document.getElementById("tutorialOverlay")
					if (tutorialOverlay && tutorialOverlay.style.visibility === "visible") {
						tutorialOverlay.style.opacity = "0"
					}
					tutorialExplosionTimeout = null
				}, TUTORIAL_FADE_DELAY)
				
				// Place trophy after delay
				setTimeout(() => {
					placeTrophy()
				}, TROPHY_PLACEMENT_DELAY)
			}
		}
	}
}

function handleCollisionWithObstacle() {
	let ballRadius = getBallRadius()
	let pushAwayBuffer = 1 // Small buffer to prevent sticking
	
	for (let i = 0; i < obstacles.length; i++) {
		let obstacle = obstacles[i]
		let dx = ball.xPos - obstacle.xPos
		let dy = ball.yPos - obstacle.yPos
		let distance = Math.hypot(dx, dy)
		let collisionDistance = ballRadius + obstacle.radius
		
		if (distance < collisionDistance && distance > 0) {
			// Normalize direction
			let normalX = dx / distance
			let normalY = dy / distance
			
			// Position ball at edge of obstacle with a small buffer to prevent sticking
			let separationDistance = collisionDistance + pushAwayBuffer
			ball.xPos = obstacle.xPos + normalX * separationDistance
			ball.yPos = obstacle.yPos + normalY * separationDistance
			
			// Reflect velocity and add a small push-away to prevent orbiting
			let dot = ball.xVel * normalX + ball.yVel * normalY
			ball.xVel = ball.xVel - 2 * dot * normalX + normalX * 0.5
			ball.yVel = ball.yVel - 2 * dot * normalY + normalY * 0.5
		}
	}
}

function handleCollisionWithEdge() {
	let radius = getBallRadius()
	
	// Check top and bottom edges
	if (ball.yPos - radius <= 0) {
		ball.yPos = radius
		ball.yVel = -ball.yVel
	} else if (ball.yPos + radius >= canvas.height) {
		ball.yPos = canvas.height - radius
		ball.yVel = -ball.yVel
	}
	
	// Check left and right edges
	if (ball.xPos - radius <= 0) {
		ball.xPos = radius
		ball.xVel = -ball.xVel
	} else if (ball.xPos + radius >= canvas.width) {
		ball.xPos = canvas.width - radius
		ball.xVel = -ball.xVel
	}
}

function handleCollisionWithTrophy() {
	if (!trophy) return
	
	let ballRadius = getBallRadius()
	let dx = ball.xPos - trophy.xPos
	let dy = ball.yPos - trophy.yPos
	let distance = Math.hypot(dx, dy)
	let collisionDistance = ballRadius + trophy.radius
	
	if (distance < collisionDistance && distance > 0) {
		// Ball hit the trophy - start animation toward the score indicator
		// Prevent multiple collisions
		if (trophy.animating) return

		// Compute the visual center of the completion score text, so the trophy flies
		// directly into it (instead of the text's right-edge baseline).
		let scoreCenter = getScoreCenter()
		
		// Start animation
		trophy.animating = true
		trophy.animationStartTime = Date.now()
		trophy.startX = trophy.xPos
		trophy.startY = trophy.yPos
		trophy.targetX = scoreCenter.x
		trophy.targetY = scoreCenter.y
		trophy.animationDuration = FADE_DURATION
		trophy.levelChanged = false // Track if level has been changed
		trophy.offscreenAt = null
		pendingNextLevel = true
	}
}

function draw() {
	ctx.clearRect(0, 0, canvas.width, canvas.height)
	// For the very first level only, fade in the grey ball and score together.
	if (initialIntroActive && !hasCompletedALevel) {
		let elapsed = Date.now() - initialIntroStartTime
		let fadeDuration = FADE_DURATION
		let t = Math.min(1.0, Math.max(0.0, elapsed / fadeDuration))
		ball.fadeOpacity = t
		
		if (t >= 1.0) {
			initialIntroActive = false
			ball.fadeOpacity = 1.0
		}
	} else {
		// Ensure ball is fully visible after the intro
		ball.fadeOpacity = 1.0
	}

	drawBall()
	
	// Update fade-in for targets
	for (let i = 0; i < targetsRemaining.length; i++) {
		let target = targetsRemaining[i]
		if (target.fadeInOpacity !== undefined && target.fadeInOpacity < 1.0) {
			let elapsed = Date.now() - target.fadeInStartTime
			let fadeDuration = FADE_DURATION
			target.fadeInOpacity = Math.min(1.0, elapsed / fadeDuration)
		}
	}
	
	// Update fade-in and fade-out for obstacles
	for (let i = obstacles.length - 1; i >= 0; i--) {
		let obstacle = obstacles[i]
		
		// Handle fade-in
		if (obstacle.fadeInOpacity !== undefined && obstacle.fadeInOpacity < 1.0) {
			let elapsed = Date.now() - obstacle.fadeInStartTime
			let fadeDuration = FADE_DURATION
			obstacle.fadeInOpacity = Math.min(1.0, elapsed / fadeDuration)
		}
		
		// Handle fade-out
		if (obstacle.fading) {
			obstacle.fadeOpacity -= 0.15 // Fade out very quickly (~0.2 seconds at 30fps)
			if (obstacle.fadeOpacity <= 0) {
				obstacles.splice(i, 1)
			}
		}
	}
	
	drawTargets()
	drawObstacles()
	
	// Update trophy fade-in
	if (trophy && trophy.fadeInOpacity !== undefined && trophy.fadeInOpacity < 1.0) {
		let elapsed = Date.now() - trophy.fadeInStartTime
		let fadeDuration = 1000 // 1.0 seconds to fade in (slower)
		trophy.fadeInOpacity = Math.min(1.0, elapsed / fadeDuration)
	}
	
	// Update trophy animation if active
	if (trophy && trophy.animating) {
		let currentTime = Date.now()
		let elapsed = currentTime - trophy.animationStartTime
		
		if (elapsed <= trophy.animationDuration) {
			// Interpolate to corner over exactly 1 second
			let progress = elapsed / trophy.animationDuration
			trophy.xPos = trophy.startX + (trophy.targetX - trophy.startX) * progress
			trophy.yPos = trophy.startY + (trophy.targetY - trophy.startY) * progress
		} else {
			// Continue moving past corner at same speed/direction
			let dx = trophy.targetX - trophy.startX
			let dy = trophy.targetY - trophy.startY
			let speed = Math.hypot(dx, dy) / (trophy.animationDuration / 1000) // pixels per second
			let angle = Math.atan2(dy, dx)
			let extraTime = (elapsed - trophy.animationDuration) / 1000 // seconds past 1 second
			let extraDistance = speed * extraTime
			
			trophy.xPos = trophy.targetX + Math.cos(angle) * extraDistance
			trophy.yPos = trophy.targetY + Math.sin(angle) * extraDistance
		}
		
		// Check if trophy has reached the completion score text (visual center)
		let scoreCenter = getScoreCenter()
		let distanceToIndicator = Math.hypot(trophy.xPos - scoreCenter.x, trophy.yPos - scoreCenter.y)
		
		if (distanceToIndicator < trophy.radius && !trophy.levelChanged) {
			// Trophy has contacted the score indicator:
			//  - wait a short delay, then increment the score
 			//  - then change level (no grey-ball fade)
			trophy.levelChanged = true
			trophy.scoreIncrementTime = Date.now() + 200 // delay score increment by 0.2s
			trophy.scoreIncremented = false
			trophy.nextLevelTime = Date.now() + FADE_DURATION // change level after delay
		}

		// Apply the delayed score increment once the delay has passed
		if (trophy.levelChanged && !trophy.scoreIncremented && trophy.scoreIncrementTime && Date.now() >= trophy.scoreIncrementTime) {
			completionScore++
			trophy.scoreIncremented = true
		}
 		
 		// Change level after the scheduled delay (no grey-ball fade)
 		if (trophy.levelChanged && trophy.nextLevelTime && Date.now() >= trophy.nextLevelTime) {
			trophy = null
			pendingNextLevel = false
			// Mark that we've completed at least one level so future levels
			// can animate the ball into its starting spot.
			hasCompletedALevel = true
			// Tutorial only runs on level 1; mark it completed after finishing that level.
			if (level === 1 && !tutorialCompleted) {
				tutorialCompleted = true
				tutorialStep = 0
				updateTutorial()
			}
 			generateLevel()
 			return
 		}
		
		// When trophy fully exits, just remove it (grey ball fade already in progress)
		if (trophy.xPos < -trophy.radius * 2 && trophy.yPos < -trophy.radius * 2) {
			trophy = null
		}
	}
	
	// Draw the score first, then draw the trophy on top of it (z-order)
	drawCompletionScore()
	drawTrophy()
	drawFireworks()
}

function createFireworks(x, y, color = "blue") {
	// Create liquid explosion effect with particles
	let particleCount = 12
	let particleColor
	if (color === "red") {
		particleColor = "rgba(255, 0, 0, 1.0)"
	} else if (color === "white") {
		particleColor = "rgba(255, 255, 255, 1.0)"
	} else if (color === "gold") {
		particleColor = "rgba(255, 215, 0, 1.0)" // Gold
	} else {
		particleColor = "rgba(0, 0, 255, 1.0)" // Blue
	}
	
	for (let i = 0; i < particleCount; i++) {
		let angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.7
		let speed = 1.5 + Math.random() * 2 // Smaller, slower particles
		fireworks.push({
			x: x,
			y: y,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed,
			life: 15 + Math.random() * 10, // Shorter lifetime
			maxLife: 15 + Math.random() * 10,
			color: particleColor,
			size: 3 + Math.random() * 3 // Larger particles
		})
	}
}

function drawFireworks() {
	// Save canvas state
	ctx.save()
	
	for (let i = fireworks.length - 1; i >= 0; i--) {
		let firework = fireworks[i]
		
		// Update position
		firework.x += firework.vx
		firework.y += firework.vy
		firework.vy += 0.15 // Gravity
		firework.vx *= 0.98 // Friction
		firework.life--
		
		// Draw particle with fading opacity
		let alpha = firework.life / firework.maxLife
		
		// Only draw if particle is still alive and alpha is positive
		if (alpha > 0 && firework.life > 0) {
			ctx.globalAlpha = alpha * 0.8 // Subtle effect
			ctx.fillStyle = firework.color
			ctx.beginPath()
			ctx.arc(firework.x, firework.y, firework.size * alpha, 0, Math.PI * 2)
			ctx.fill()
		}
		
		// Remove dead particles
		if (firework.life <= 0) {
			fireworks.splice(i, 1)
		}
	}
	
	// Restore canvas state (resets all properties including alpha, fillStyle, etc.)
	ctx.restore()
}

function drawBall() {
	let radius = getBallRadius()
	let x = ball.xPos
	let y = ball.yPos
	
	// Apply fade opacity
	ctx.save()
	ctx.globalAlpha = ball.fadeOpacity !== undefined ? ball.fadeOpacity : 1.0

	// Simple sphere with subtle gradient
	let gradient = ctx.createRadialGradient(
		x - radius * 0.5, y - radius * 0.5, 0,
		x, y, radius
	)
	gradient.addColorStop(0, "#b0b0b0")
	gradient.addColorStop(1, "#606060")
	
	ctx.beginPath()
	ctx.arc(x, y, radius, 0, 2 * Math.PI)
	ctx.fillStyle = gradient
	ctx.fill()

	ctx.restore()
}

function drawTargets() {
	for (let i=0; i<targetsRemaining.length; i++) {
		let target = targetsRemaining[i]
		let radius = getTargetRadius()
		let x = target.xPos
		let y = target.yPos
		
		// Get opacity (fade-in or default to 1.0)
		let opacity = target.fadeInOpacity !== undefined ? target.fadeInOpacity : 1.0
		
		ctx.save()
		ctx.globalAlpha = opacity
		
		// Simple sphere with subtle gradient
		let gradient = ctx.createRadialGradient(
			x - radius * 0.5, y - radius * 0.5, 0,
			x, y, radius
		)
		gradient.addColorStop(0, "#3333ff")
		gradient.addColorStop(1, "#0000aa")
		
		ctx.beginPath()
		ctx.arc(x, y, radius, 0, 2 * Math.PI)
		ctx.fillStyle = gradient
		ctx.fill()
		
		ctx.restore()
	}
}

function drawObstacles() {
	for (let i = 0; i < obstacles.length; i++) {
		let obstacle = obstacles[i]
		let radius = obstacle.radius
		let x = obstacle.xPos
		let y = obstacle.yPos
		
		// Get opacity (fade-in takes priority, then fade-out, then default to 1.0)
		let opacity = 1.0
		if (obstacle.fadeInOpacity !== undefined) {
			opacity = obstacle.fadeInOpacity
		}
		if (obstacle.fading && obstacle.fadeOpacity !== undefined) {
			opacity = obstacle.fadeOpacity
		}
		
		ctx.save()
		ctx.globalAlpha = opacity
		
		// Simple sphere with subtle gradient
		let gradient = ctx.createRadialGradient(
			x - radius * 0.5, y - radius * 0.5, 0,
			x, y, radius
		)
		gradient.addColorStop(0, "#ff3333")
		gradient.addColorStop(1, "#aa0000")
		
		ctx.beginPath()
		ctx.arc(x, y, radius, 0, 2 * Math.PI)
		ctx.fillStyle = gradient
		ctx.fill()
		
		ctx.restore()
	}
}

function drawTrophy() {
	if (!trophy) return
	
	let radius = trophy.radius
	let x = trophy.xPos
	let y = trophy.yPos
	
	// Get opacity (fade-in or default to 1.0)
	let opacity = trophy.fadeInOpacity !== undefined ? trophy.fadeInOpacity : 1.0
	
	ctx.save()
	ctx.globalAlpha = opacity
	
	// Draw trophy in gold/yellow with gradient
	let gradient = ctx.createLinearGradient(x, y - radius, x, y + radius)
	gradient.addColorStop(0, "#ffed4e") // Lighter gold at top
	gradient.addColorStop(0.5, "#ffd700") // Gold in middle
	gradient.addColorStop(1, "#daa520") // Darker gold at bottom
	ctx.fillStyle = gradient
	ctx.strokeStyle = "#b8860b" // Dark gold for outline
	ctx.lineWidth = 3
	
	// Trophy base (bottom, wider and perfectly centered)
	let baseWidth = radius * 1.0
	let baseHeight = radius * 0.15
	let baseY = y + radius * 0.35
	ctx.beginPath()
	ctx.rect(x - baseWidth / 2, baseY, baseWidth, baseHeight)
	ctx.fill()
	ctx.stroke()
	
	// Trophy stem/pedestal (connects base to cup, perfectly centered)
	let stemWidth = radius * 0.3
	let stemHeight = radius * 0.2
	let stemY = y + radius * 0.15
	ctx.beginPath()
	ctx.rect(x - stemWidth / 2, stemY, stemWidth, stemHeight)
	ctx.fill()
	ctx.stroke()
	
	// Trophy cup/bowl (main body, perfectly symmetrical)
	let cupBottomY = stemY
	let cupTopY = y - radius * 0.3
	let cupBottomWidth = radius * 0.4
	let cupTopWidth = radius * 0.7
	let cupInnerTopWidth = radius * 0.4
	
	ctx.beginPath()
	// Start at bottom left
	ctx.moveTo(x - cupBottomWidth / 2, cupBottomY)
	// Left side curve (symmetric)
	ctx.quadraticCurveTo(
		x - cupTopWidth / 2, (cupBottomY + cupTopY) / 2,
		x - cupTopWidth / 2, cupTopY
	)
	// Top rim left
	ctx.lineTo(x - cupInnerTopWidth / 2, cupTopY)
	// Inner left edge
	ctx.lineTo(x - cupInnerTopWidth / 2, cupTopY + radius * 0.1)
	// Inner bottom curve (symmetric)
	ctx.quadraticCurveTo(x, cupTopY + radius * 0.15, x + cupInnerTopWidth / 2, cupTopY + radius * 0.1)
	// Inner right edge
	ctx.lineTo(x + cupInnerTopWidth / 2, cupTopY)
	// Top rim right
	ctx.lineTo(x + cupTopWidth / 2, cupTopY)
	// Right side curve (symmetric to left)
	ctx.quadraticCurveTo(
		x + cupTopWidth / 2, (cupBottomY + cupTopY) / 2,
		x + cupBottomWidth / 2, cupBottomY
	)
	ctx.closePath()
	ctx.fill()
	ctx.stroke()
	
	// Trophy handles (perfectly symmetrical C-shaped handles)
	let handleRadius = radius * 0.2
	let handleXOffset = radius * 0.45
	let handleY = y - radius * 0.05
	let handleThickness = radius * 0.12
	
	// Left handle (C-shaped, opening to the right)
	ctx.beginPath()
	ctx.arc(x - handleXOffset, handleY, handleRadius, Math.PI * 0.5, Math.PI * 1.5, false)
	ctx.lineWidth = handleThickness
	ctx.lineCap = "round"
	ctx.stroke()
	
	// Right handle (C-shaped, opening to the left, perfectly mirrored)
	ctx.beginPath()
	ctx.arc(x + handleXOffset, handleY, handleRadius, Math.PI * 1.5, Math.PI * 0.5, false)
	ctx.stroke()
	
	// Star on top (perfectly centered, 5-pointed star)
	ctx.fillStyle = "#ffd700"
	ctx.strokeStyle = "#ffaa00"
	ctx.lineWidth = 2
	ctx.beginPath()
	let starX = x
	let starY = y - radius * 0.4
	let starOuterRadius = radius * 0.15
	let starInnerRadius = starOuterRadius * 0.5
	let starPoints = 5
	
	for (let i = 0; i < starPoints * 2; i++) {
		let angle = (Math.PI * i) / starPoints - Math.PI / 2
		let r = (i % 2 === 0) ? starOuterRadius : starInnerRadius
		let px = starX + Math.cos(angle) * r
		let py = starY + Math.sin(angle) * r
		if (i === 0) {
			ctx.moveTo(px, py)
		} else {
			ctx.lineTo(px, py)
		}
	}
	ctx.closePath()
	ctx.fill()
	ctx.stroke()
	
	ctx.restore()
}

function getScoreCenter() {
	let scoreTextX = canvas.width - 12
	let scoreTextY = 56
	ctx.save()
	ctx.font = "bold 56px Arial"
	ctx.textAlign = "right"
	let scoreMetrics = ctx.measureText(`${completionScore}`)
	let scoreWidth = scoreMetrics.width || 0
	let ascent = scoreMetrics.actualBoundingBoxAscent
	let descent = scoreMetrics.actualBoundingBoxDescent
	if (!Number.isFinite(ascent)) ascent = 56
	if (!Number.isFinite(descent)) descent = 0
	let left = scoreTextX - scoreWidth
	let right = scoreTextX
	let top = scoreTextY - ascent
	let bottom = scoreTextY + descent
	ctx.restore()
	return {
		x: (left + right) / 2,
		y: (top + bottom) / 2
	}
}

function drawCompletionScore() {
	ctx.font = "bold 56px Arial"
	let scoreText = `${completionScore}`
	
	// Draw text outline for better visibility
	ctx.strokeStyle = "black"
	ctx.lineWidth = 6
	ctx.lineJoin = "round"
	ctx.miterLimit = 2
	
	// Position at top right with padding
	ctx.textAlign = "right"
	let textX = canvas.width - 12
	let textY = 56

	// For the very first level only, fade in the score in sync with the grey ball.
	let scoreAlpha = 1.0
	if (initialIntroActive && !hasCompletedALevel) {
		let elapsed = Date.now() - initialIntroStartTime
		let fadeDuration = FADE_DURATION
		scoreAlpha = Math.min(1.0, Math.max(0.0, elapsed / fadeDuration))
	}
	
	ctx.save()
	ctx.globalAlpha = scoreAlpha
	
	// Draw outline
	ctx.strokeText(scoreText, textX, textY)
	
	// Draw fill text (match trophy gold color)
	ctx.fillStyle = "#ffd700"
	ctx.fillText(scoreText, textX, textY)
	
	ctx.restore()
	
	// Draw score increment indicator if active
	if (scoreIncrementDisplay && scoreIncrementDisplay.opacity > 0) {
		ctx.save()
		ctx.globalAlpha = scoreIncrementDisplay.opacity
		
		// Measure score text width to position increment indicator
		let scoreWidth = ctx.measureText(scoreText).width
		let incrementX = textX + scoreWidth + 15 // Position to the right of score
		let incrementY = textY
		
		// Draw increment text (smaller font)
		ctx.font = "bold 36px Arial"
		let incrementText = `+${scoreIncrementDisplay.amount}`
		
		// Draw outline
		ctx.strokeStyle = "black"
		ctx.lineWidth = 4
		ctx.strokeText(incrementText, incrementX, incrementY)
		
		// Draw fill (green for positive)
		ctx.fillStyle = "#00ff00"
		ctx.fillText(incrementText, incrementX, incrementY)
		
		ctx.restore()
		
		// Update opacity and time (updated each frame)
		const SCORE_INCREMENT_FADE_DURATION = 1.0 // seconds
		scoreIncrementDisplay.timeLeft -= MS_PER_FRAME / 1000 // Convert ms to seconds
		if (scoreIncrementDisplay.timeLeft <= 0) {
			scoreIncrementDisplay = null
		} else {
			// Fade out over time (linear fade)
			scoreIncrementDisplay.opacity = Math.max(0, scoreIncrementDisplay.timeLeft / SCORE_INCREMENT_FADE_DURATION)
		}
	}
}

function updateTutorial() {
	let tutorialOverlay = document.getElementById("tutorialOverlay")
	if (!tutorialOverlay || !canvas) return
	
	// Tutorial runs:
	// - Level 1: multi-step tutorial (fling, hit, switch).
	// - Level 2: single reminder text about switching.
	if ((level === 1 && (tutorialStep === 0 || tutorialCompleted)) ||
	    (level === 2 && tutorialStep === 0) ||
	    (level !== 1 && level !== 2)) {
		tutorialOverlay.style.opacity = "0"
		tutorialOverlay.style.visibility = "hidden"
		tutorialOverlay.textContent = ""
		return
	}
	
	let text = ""
	if (level === 1) {
		if (tutorialStep === 1) {
			text = "Fling the grey ball"
		} else if (tutorialStep === 2) {
			text = "Hit all the blue balls"
		} else if (tutorialStep === 3) {
			text = "Tap blue then red to switch them"
		}
	} else if (level === 2) {
		text = "Switch red and blue balls by tapping them"
	}

	// Set text and measure once for simple centered placement near the bottom.
	tutorialOverlay.textContent = text
	tutorialOverlay.style.visibility = "hidden"
	tutorialOverlay.offsetHeight // force reflow

	let padding = 40
	let textShadowBuffer = 20
	let measuredWidth = tutorialOverlay.offsetWidth || 300
	let measuredHeight = tutorialOverlay.offsetHeight || 30
	let textWidth = measuredWidth + textShadowBuffer * 2
	let textHeight = measuredHeight + textShadowBuffer * 2
	let textHalfWidth = textWidth / 2
	let textHalfHeight = textHeight / 2
	
	let topExclusionY = canvas.height * 0.2
	
	// Base position: relative to the ball's y-position, horizontally centered.
	let ballRadius = getBallRadius()
	let baseX = canvas.width / 2
	// Place the text three ball-radii (1.5 diameters) above the ball.
	let baseY = (ball?.yPos ?? (canvas.height - padding - textHalfHeight)) - (3 * ballRadius)

	// Clamp inside safe region and away from score area at the very top.
	let xPos = Math.max(padding + textHalfWidth, Math.min(baseX, canvas.width - padding - textHalfWidth))
	let yPos = Math.max(topExclusionY + textHalfHeight + padding, Math.min(baseY, canvas.height - padding - textHalfHeight))

	// For level 1, remember the absolute position we actually used.
	if (level === 1) {
		tutorialLastX = xPos
		tutorialLastY = yPos
	}

	// For level 2, reuse the exact absolute position from level 1 if we have it.
	if (level === 2 && tutorialLastX !== null && tutorialLastY !== null) {
		xPos = tutorialLastX
		yPos = tutorialLastY
	}

	tutorialOverlay.style.left = xPos + "px"
	tutorialOverlay.style.top = yPos + "px"
	tutorialOverlay.style.opacity = "1"
	tutorialOverlay.style.visibility = "visible"
}

function isObjectCloseToObject(objectA, distance, objectB) {
  return (
    Math.abs(objectA.xPos - objectB.xPos) < distance && 
    Math.abs(objectA.yPos - objectB.yPos) < distance
  )
}

function resizeCanvas() {
	if (canvas && !isGeneratingLevel) {
		// Use window dimensions to avoid zoom issues with visualViewport
		// visualViewport can cause zoom when the keyboard appears/disappears
		canvas.width = window.innerWidth
		canvas.height = window.innerHeight
	}
}