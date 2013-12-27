Cascading Relations for Mongoose
================================
This is a Mongoose plugin that adds cascading save and remove functionality for defined relationships between documents.

## Rationale
I created this plugin for two reasons. 

One, I found it increasingly annoying to convert populated documents back into their original form when communicating back and forth between client and server. Mongoose's `populate` method is awesome, but when sending back, I had to convert the populated data back to its `_id`.

Two, I wanted an easy way to handle actual ORM using Mongoose. Mongoose bills itself as an ORM but the only actual relationship mapping it does is with its `ObjectID` type and the `populate` method.

## Usage
This plugin adds a special field to Mongoose schemas called `_related`. All document relationships are run through this field.

#### Changed functionality of `populate`
When you run the `populate` method, instead of populating by replacing the `ObjectID` references, it populates on the exact path but within the `_related` field. This gives you access to related documents while keeping the actual database fields intact for write operations. For example:

```javascript
mySchema.find().populate('foo').exec(function(err, results) {
	// The "title" attribute of the related foo
	console.log(results[0]._related.foo.title); 

	// The _id field of the related foo
	console.log(results[0].foo)
});
```

#### Schema Definitions
As with the Mongoose core, related documents are specified with a combination of `type:mongoose.Schema.Types.ObjectId` and `ref:'Related_Model'`. This plugin adds two more configuration options to `ObjectID` types: **$through** and **$cascadeDelete**.

**$through** defines the path on the related document that is a reference back to this document. If you have two schema like so:

```javascript
var cascadingRelations = require('cascading-relations');
var fooSchema = new mongoose.Schema({
	title:String,
	bars:[{
		type:mongoose.Schema.Types.ObjectId,
		ref:'Bar',
		$through:'foo'
	}]
});

// Apply the plugin
fooSchema.plugin(cascadingRelations);

var barSchema = new mongoose.Schema({
	title:String,
	foo:{
		type:mongoose.Schema.Types.ObjectId,
		ref:'Foo'
	}
});

// Apply the plugin
barSchema.plugin(cascadingRelations);
```

...then the `foo` property of each related `bar` will be populated with the `_id` field of the `Foo` document.

**$cascadeDelete** defines whether or not deleting a document will also delete its related documents. If this is set to `true`, then all related documents will be deleted when the main document is deleted. If it is `false` or undefined, then only the `$through` field of related documents will be nullified (if it's a single relationship) or the removed document's `_id` will be removed from the `$through` field (if it's a multi relationship). The related document(s) will remain in the database.

#### Creating Related Documents
You can create related documents in one model by using aforementioned the `_related` field:

```javascript
var fooModel = mongoose.model('Foo')

var myFoo = new fooModel({
	title:'My Foo',
	_related:{
		bars:[
			{
				title:'My First Bar'
			},
			{
				title:'My Second Bar'
			}
		]
		single_bar:{
			title:'My Single Bar'
		}
	}
});
```

> **IMPORTANT!** When you save, you need to use `myFoo.cascadeSave()` instead of `myFoo.save()`. `cascadeSave()` will update all reference fields on the main document and all related documents, cascade through infinite levels of related documents, and update the corresponding `_related` fields with the saved documents (including `_id`, `__v`, etc). Using the `save()` method will save using the Mongoose core - anything set in the `_related` field will not be saved (although it will still be accessible after the DB write operation)

## Issues
#### Post Middleware w/ Cascade Delete
Because Mongoose still does not have callbacks implemented in its `post` middleware, all cascade delete operations happen behind the scenes after the callback is executed for the initial `remove()` call. Because of this, if you query the database immediately after running `remove()`, the cascade delete processes still may not have finished. In our tests, we get around this by simply waiting 5 seconds before checking if the process was successful. Keep this in mind when using this plugin - unfortunately there is nothing we can really do except for writing a custom middleware handler.

#### Exception Handling
Currently if saving one related document fails (for validation or another reason), it bubbles up all the way to the top and stops the saving of the original document. I'm considering adding some configuration options to ignore these issues and continue with the save process.
