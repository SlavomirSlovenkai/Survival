function Barter() {}

Barter.prototype.Schema =
	"<a:component type='system'/><empty/>";

/**
 * The "true price" is a base price of 100 units of resource (for the case of some resources being of more worth than others).
 * With current bartering system only relative values makes sense so if for example stone is two times more expensive than wood,
 * there will 2:1 exchange rate.
 *
 * Constant part of price percentage difference between true price and buy/sell price.
 * Buy price equal to true price plus constant difference.
 * Sell price equal to true price minus constant difference.
 */
Barter.prototype.CONSTANT_DIFFERENCE = 10;
/**
 * Additional difference of prices in percents, added after each deal to specified resource price.
 */
Barter.prototype.DIFFERENCE_PER_DEAL = 2;
/**
 * Price difference percentage which restored each restore timer tick
 */
Barter.prototype.DIFFERENCE_RESTORE = 0.5;
/**
 * Interval of timer which slowly restore prices after deals
 */
Barter.prototype.RESTORE_TIMER_INTERVAL = 5000;

Barter.prototype.Init = function()
{
	this.priceDifferences = {};
	for (let resource of Resources.GetCodes("barterable"))
		this.priceDifferences[resource] = 0;
	this.restoreTimer = undefined;
};

Barter.prototype.GetPrices = function(playerID)
{
	let prices = { "buy": {}, "sell": {} };
	let multiplier = QueryPlayerIDInterface(playerID).GetBarterMultiplier();
	for (let resource of Resources.GetCodes("barterable"))
	{
		let truePrice = Resources.GetResource(resource).truePrice;
		if (multiplier.buy[resource] === undefined) {
			error("multiplier.buy[" + resource + "] is not defined");
			continue;
		}
		if (multiplier.sell[resource] === undefined) {
			error("multiplier.sell[" + resource + "] is not defined");
			continue;
		}
		prices.buy[resource] = truePrice * (100 +  this.priceDifferences[resource]) * multiplier.buy[resource] / 100;
		prices.sell[resource] = truePrice * (100 -  this.priceDifferences[resource]) * multiplier.sell[resource] / 100;
	}
	return prices;
};

Barter.prototype.PlayerHasMarket = function(playerID)
{
	let cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	let entities = cmpRangeManager.GetEntitiesByPlayer(playerID);
	for (let entity of entities)
	{
		let cmpFoundation = Engine.QueryInterface(entity, IID_Foundation);
		let cmpIdentity = Engine.QueryInterface(entity, IID_Identity);
		if (!cmpFoundation && cmpIdentity && cmpIdentity.HasClass("BarterMarket"))
			return true;
	}
	return false;
};

Barter.prototype.ExchangeResources = function(playerID, resourceToSell, resourceToBuy, amount)
{
	if (amount <= 0)
	{
		warn("ExchangeResources: incorrect amount: " + uneval(amount));
		return;
	}

	let availResources = Resources.GetCodes("barterable");
	if (availResources.indexOf(resourceToSell) == -1)
	{
		warn("ExchangeResources: incorrect resource to sell: " + uneval(resourceToSell));
		return;
	}

	if (availResources.indexOf(resourceToBuy) == -1)
	{
		warn("ExchangeResources: incorrect resource to buy: " + uneval(resourceToBuy));
		return;
	}

	// This can occur when the player issues the order just before the market is destroyed or captured
	if (!this.PlayerHasMarket(playerID))
		return;

	if (amount != 100 && amount != 500)
		return;

	let cmpPlayer = QueryPlayerIDInterface(playerID);
	let prices = this.GetPrices(playerID);
	let amountsToSubtract = {};
	amountsToSubtract[resourceToSell] = amount;
	if (cmpPlayer.TrySubtractResources(amountsToSubtract))
	{
		let amountToAdd = Math.round(prices["sell"][resourceToSell] / prices["buy"][resourceToBuy] * amount);
		cmpPlayer.AddResource(resourceToBuy, amountToAdd);

		// Display chat message to observers
		let cmpGUIInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
		if (cmpGUIInterface)
			cmpGUIInterface.PushNotification({
				"type": "barter",
				"players": [playerID],
				"amountsSold": amount,
				"amountsBought": amountToAdd,
				"resourceSold": resourceToSell,
				"resourceBought": resourceToBuy
			});

		let cmpStatisticsTracker = QueryPlayerIDInterface(playerID, IID_StatisticsTracker);
		if (cmpStatisticsTracker)
		{
			cmpStatisticsTracker.IncreaseResourcesSoldCounter(resourceToSell, amount);
			cmpStatisticsTracker.IncreaseResourcesBoughtCounter(resourceToBuy, amountToAdd);
		}

		if (resourceToBuy == "coin" || resourceToSell == "coin")
			return;
		
		let difference = this.DIFFERENCE_PER_DEAL * amount / 100;
		// Increase price difference for both exchange resources.
		// Overall price difference (dynamic +/- constant) can't exceed +-99%.
	//	this.priceDifferences[resourceToSell] -= difference;
	//	this.priceDifferences[resourceToSell] = Math.min(99 , Math.max(99, this.priceDifferences[resourceToSell]));
		this.priceDifferences[resourceToBuy] += difference;
		this.priceDifferences[resourceToBuy] = Math.min(99 , Math.max(1, this.priceDifferences[resourceToBuy]));
	}

	if (this.restoreTimer === undefined)
	{
		let cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
		this.restoreTimer = cmpTimer.SetInterval(this.entity, IID_Barter, "ProgressTimeout", this.RESTORE_TIMER_INTERVAL, this.RESTORE_TIMER_INTERVAL, {});
	}
};

Barter.prototype.ProgressTimeout = function(data)
{
	let needRestore = false;
	for (let resource of Resources.GetCodes("barterable"))
	{
		// Calculate value to restore, it should be limited to [-DIFFERENCE_RESTORE; DIFFERENCE_RESTORE] interval
		let differenceRestore = Math.min(this.DIFFERENCE_RESTORE, Math.max(-this.DIFFERENCE_RESTORE, this.priceDifferences[resource]));
		differenceRestore = -differenceRestore;
		this.priceDifferences[resource] += differenceRestore;
		// If price difference still exists then set flag to run timer again
		if (this.priceDifferences[resource] != 0)
			needRestore = true;
	}

	if (!needRestore)
	{
		let cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
		cmpTimer.CancelTimer(this.restoreTimer);
		this.restoreTimer = undefined;
	}
};

Engine.RegisterSystemComponentType(IID_Barter, "Barter", Barter);
