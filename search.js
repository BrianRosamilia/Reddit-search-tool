searchTool = {
	init: function() {
		this.searchBox = new searchTool.SearchBox({el: $("#search")});
	}
}

searchTool.QueryTerm = Backbone.Model.extend({
	defaults: function() {
		var defaultField = "text";
		
		return _.extend({field : defaultField},
				this.typeDefaults[this.termTypes[defaultField]]);
	},
	
	initialize: function() {
		//Is this the right way?
		this.on("change:field", this.recalculateType);
	},
	
	typeDefaults: {
		// Keys are quoted because boolean is a keyword (even though it's unused)
		"text": {
			type: "text",
			value: "",
			isInverted: false,
			requireAll: true,
			isPhrase: false
		},
		"boolean": {
			type: "boolean",
			value: false
		},
		"date": {
			type: "date",
			from: new Date(),
			to: new Date()
		}
	},
	
	termTypes: {
		text: 'text',
		title: 'text',
		selftext: 'text',
		timestamp: 'date',
		is_self: 'boolean',
		author: 'text',
		subreddit: 'text',
		over18: 'boolean',
		site: 'text',
		url: 'text',
		flair_text: 'text',
		flair_css_class: 'text'
	},
	
	recalculateType: function() {
		var oldType = this.get("type");
		var field = this.get("field");
		var newType = this.termTypes[field];
		
		if (newType !== oldType) {
			this.set(this.typeDefaults[newType]);
		}
	},
	
	canUsePlain: function() {
		if (this.get("type") === "text") {
			if (this.get("field") === "text") {
				if (this.get("isInverted") === false &&
						this.get("requireAll") === true &&
						this.get("isPhrase") === false) {
					return true;
				}
			}
		}
		
		return false;
	},
	
	canUseLucene: function() {
		var type = this.get("type");
		
		if (type === "boolean") {
			return true;
		} else if (type === "text") {
			return !this.get("isPhrase");
		} else if (type === "date") {
			return false;
		}
	},
	
	getPlainQuery: function() {
		//We already know that the field is "text".
		return this.get("value").trim();
	},
	
	getLuceneQuery: function() {
		var type = this.get("type");
		
		if (type === "boolean") {
			return this.get("field") + ":" + (this.get("value") ? "yes" : "no");
		} else if (type === "text") {
			if (this.get("isPhrase")) {
				return;
			}
			var result = this.get("value").trim();
			var words = result.split(" ")
			if (!this.get("requireAll") || this.get("isInverted")) {
				result = words.join(" OR ");
			}
			
			if (words.length > 1) {
				result = this.get("field") + ":(" + result + ")"
			} else {
				result = this.get("field") + ":" + result;
			}
			
			if (this.get("isInverted")) {
				return "NOT " + result;
			} else {
				return result;
			}
		} else if (type === "date") {
			return "";
		}
	},
	
	getCloudsearchQuery: function() {
		var type = this.get("type");
		
		if (type === "boolean") {
			return this.get("field") + ":" + (this.get("value") ? 1 : 0);
		} else if (type === "text") {
			var result;
			if (this.get("isPhrase")) {
				//Note: Single quote followed by double quote means phrase query
				result = "(field " + this.get("field") + " '\"" + this.get("value").trim() + "\"')";
			} else {
				var words = this.get("value").trim().split(" ");
				// Not sure of the best way of doing this; right now I'll modify the array in-place
				for (var i = 0; i < words.length; i++) {
					words[i] = "(field " + this.get("field") + " '" + words[i] + "')"
				}
				result = words.join(" ");
			}
			
			if (this.get("requireAll") && !this.get("isInverted")) {
				result = "(and " + result + ")";
			} else {
				result = "(or " + result + ")";
			}
			if (this.get("isInverted")) {
				result = "(not " + result + ")";
			}
			return result;
		} else if (type === "date") {
			//TODO: Timezone stuff with cloudsearch - pretty sure it's not UTC.
			
			var fromTimestamp = this.get("from").getTime();
			var toTimestamp = this.get("to").getTime();
			
			//Milliseconds to seconds - probably not the best way.
			fromTimestamp = Math.round(fromTimestamp / 1000);
			toTimestamp = Math.round(toTimestamp / 1000);
			
			return this.get("field") + ":" + fromTimestamp + ".." + toTimestamp;
		}
	}
});

searchTool.SearchQuery = Backbone.Collection.extend({
	model: searchTool.QueryTerm,
	
	canUsePlain: function() {
		return this.all(function(item) { return item.canUsePlain() } );
	},
	
	canUseLucene: function() {
		return this.all(function(item) { return item.canUseLucene() } );
	},
	
	getQuery: function(syntax) {
		if (syntax === "plain") {
			var terms = this.map(function(item) {
				return item.getPlainQuery();
			});
			
			return terms.join(" ");
		} else if (syntax === "lucene") {
			var terms = this.map(function(item) {
				return item.getLuceneQuery();
			});
			
			return terms.join(" ");
		} else if (syntax === "cloudsearch") {
			var terms = this.map(function(item) {
				return item.getCloudsearchQuery();
			});
			
			if (terms.length > 1) {
				return "(and " + terms.join(" ") + ")";
			} else {
				return terms.join(" "); //Is this clear?
			}
		}
	}
	//TODO
});

searchTool.QueryTermView = Backbone.View.extend({
	tagName: "li",
	
	template: _.template("<select class=\"field-dropdown\">" +
					"<option value=\"text\">Title and text</option>" +
					"<option value=\"title\">Title</option>" +
					"<option value=\"selftext\">Self text</option>" +
					"<option value=\"timestamp\">Submission time</option>" +
					"<option value=\"is_self\">Post type (link, self post)</option>" + //Maybe use type_id?
					"<option value=\"author\">Author</option>" +
					"<option value=\"subreddit\">Subreddit</option>" +
					"<option value=\"over18\">NSFW</option>" +
					"<option value=\"site\">Domain</option>" +
					"<option value=\"url\">URL</option>" +
					"<option value=\"flair_text\">Flair text</option>" +
					"<option value=\"flair_css_class\">Flair CSS class</option>" + //Does this need to be there?
					// Should we include num_comments?  It's not intended for public use...
					"</select>" +
					"</div><div class=\"term-data\"></div><button class=\"delete-button\" type=\"button\">Delete</button>"),
	booleanHTML: _.template("<label><input type=\"checkbox\" class=\"boolean-toggle\" <%- checked %>>Value</label>"),
	textHTML: _.template("<select class=\"selectivity\" value=\"<%- selectivity %>\"><option value=\"all\">All of these words</option><option value=\"any\">Any of these words</option><option value=\"phrase\">All of these words in this order</option><option value=\"none\">None of these words</option></select><input class=\"text\" type=\"text\" value=\"<%- value %>\">"),
	datepickerHTML: _.template("<input type=\"text\" class=\"time-from\" placeholder=\"from timestamp\"><input type=\"text\" class=\"time-to\" placeholder=\"to timestamp\">"),
	
	// Might be excessive
	events: {
		"change .field-dropdown" : "fieldDropdownChanged",
		"change .boolean-toggle" : "booleanValueChanged",
		"change .selectivity" : "selectivityChanged",
		"change .time-from" : "fromTimeChanged",
		"change .time-to" : "toTimeChanged",
		"input .text" : "textChanged",
		"click .delete-button" : "deleteClicked"
	},
	
	initialize: function() {
		this.$el.html(this.template()); //Does this really need to be a template anymore?  I assume it will be when I18n is factored in...
		
		this.listenTo(this.model, 'change:type', this.termTypeChanged);
		
		this.listenTo(this.model, 'destroy', this.remove);
		
		// Should this be called?
		this.termTypeChanged();
	},
	
	fieldDropdownChanged: function(e) {
		var newField = e.target.value;
		
		this.model.set("field", newField);
	},
	
	termTypeChanged: function() {
		var newType = this.model.get("type");
		
		if (newType === "text") {
			var selectivity;
			
			if (this.model.get("isInverted")) {
				selectivity = "none";
			} else if (this.model.get("isPhrase")) {
				selectivity = "phrase";
			} else if (!this.model.get("requireAll")) {
				selectivity = "any";
			} else {
				selectivity = "all";
			}
			
			this.$(".term-data").html(this.textHTML({value: this.model.get("value"), selectivity: selectivity}));
		} else if (newType === "boolean") {
			this.$(".term-data").html(this.booleanHTML({checked: (this.model.get("value") ? "checked" : "")}));
		} else if (newType === "date") {
			this.$(".term-data").html(this.datepickerHTML());
			
			var from = this.$(".time-from");
			var to = this.$(".time-to");
			
			from.datepicker({
				changeMonth: true,
				changeYear: true,
				dateFormat: $.datepicker.TIMESTAMP
			});
			to.datepicker({
				changeMonth: true,
				changeYear: true,
				dateFormat: $.datepicker.TIMESTAMP
			});
		}
	},
	
	booleanValueChanged: function(e) {
		this.model.set("value", e.target.checked);
	},
	selectivityChanged: function(e) {
		var value = e.target.value;
		this.model.set("isInverted", value === "none");
		this.model.set("requireAll", value !== "any");
		this.model.set("isPhrase", value === "phrase");
	},
	textChanged: function(e) {
		this.model.set("value", e.target.value);
	},
	fromTimeChanged: function(e) {
		this.$(".time-to").datepicker("option", "minDate", e.target.value);
		var when = new Date(parseInt(e.target.value, 10));
		this.model.set("from", when);
	},
	toTimeChanged: function(e) {
		this.$(".time-from").datepicker("option", "maxDate", e.target.value);
		var when = new Date(parseInt(e.target.value, 10));
		this.model.set("to", when);
	},
	deleteClicked: function(e) {
		this.model.destroy();
	}
});

searchTool.SearchBox = Backbone.View.extend({
	initialize: function() {
		this.input = this.$("#add-search-option");
		
		this.query = new searchTool.SearchQuery();

		this.listenTo(this.query, 'add', this.addOne);
		this.listenTo(this.query, 'reset', this.addAll);
		this.listenTo(this.query, 'all', this.render);

		this.query.add(new searchTool.QueryTerm());
		console.log(this.query);
	},
	
	//TODO: This should be in a model, yes?  Not a view?
	
	//User's choice about the query syntax.
	syntax: "plain",
	time: "all",
	sort: "relevance2",
	
	events: {
		"click #add-search-option": "addOption",
		"change #search-syntax": "syntaxChanged",
		"change #search-time": "timeChanged"
	},
	
	addOption: function(e) {
		this.query.add(new searchTool.QueryTerm());
	},
	
	syntaxChanged: function(e) {
		this.syntax = e.target.value;
		
		this.render();
	},
	
	timeChanged: function(e) {
		this.time = e.target.value;
	},
	
	render: function() {
		var syntax = this.syntax;
		
		if (!this.query.canUseLucene()) {
			this.$("#search-syntax > option[value=lucene]").prop("disabled", true);
			this.$("#search-syntax > option[value=plain]").prop("disabled", true);
			
			syntax = "cloudsearch";
		} else if (!this.query.canUsePlain()) {
			//Note: If we can't use lucene, we can't use plain.
			
			this.$("#search-syntax > option[value=lucene]").prop("disabled", false);
			this.$("#search-syntax > option[value=plain]").prop("disabled", true);
			
			if (syntax === "plain") {
				syntax = "lucene";
			}
		} else {
			this.$("#search-syntax > option[value=lucene]").prop("disabled", false);
			this.$("#search-syntax > option[value=plain]").prop("disabled", false);
		}
		
		// Ensure the dropdown is up to date with the selected syntax
		// especially if it was changed.
		// TODO: This may not be the right way.
		this.$("#search-syntax").val(syntax);
		
		var time = this.time;
		
		if (this.query.any(function(item) { return item.get("field") === "timestamp" } )) {
			// If the user specified a custom timestamp, the default one doesn't work.
			
			this.$("#search-time > option[value!=all]").prop("disabled", true);
			time = "all";
		} else {
			this.$("#search-time > option[value!=all]").prop("disabled", false);
		}
		
		this.$("#search-time").val(time);
		
		this.$("input[name=q]").val(this.query.getQuery(syntax));
		
		return this;
	},
	
	addOne: function(term) {
		var view = new searchTool.QueryTermView({model: term});
		this.$("#search-options-list").append(view.render().el);
	},
	
	addAll: function() {
		this.query.each(this.addOne, this);
	}
});

searchTool.init();